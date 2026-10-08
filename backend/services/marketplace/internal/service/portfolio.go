package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
	"github.com/zlobin/zlobin-beauty/backend/shared/moderation"
)

const (
	portfolioTitleMax       = 80
	portfolioDescriptionMax = 1000
	portfolioCategoryMax    = 40
)

type AddPortfolioInput struct {
	UserID      uuid.UUID
	MediaID     uuid.UUID
	Caption     string
	Title       string
	Description string
	Category    string
	SortOrder   *int
}

type UpdatePortfolioInput struct {
	UserID      uuid.UUID
	ItemID      uuid.UUID
	MediaID     *uuid.UUID
	Caption     *string
	Title       *string
	Description *string
	Category    *string
	SortOrder   *int
}

type portfolioMediaMeta struct {
	OwnerUserID uuid.UUID
	Purpose     string
	ContentType string
}

func (s *Service) WithMedia(mediaURL string) *Service {
	s.mediaURL = strings.TrimRight(mediaURL, "/")
	return s
}

func normalizePortfolioTitle(title, caption string) string {
	title = strings.TrimSpace(title)
	if title != "" {
		return title
	}
	return strings.TrimSpace(caption)
}

func mediaTypeFromContentType(ct string) string {
	ct = strings.ToLower(strings.TrimSpace(ct))
	switch {
	case ct == "image/gif":
		return "gif"
	case strings.HasPrefix(ct, "video/"):
		return "video"
	default:
		return "photo"
	}
}

func validatePortfolioFields(title, description, category string) error {
	if utf8.RuneCountInString(title) > portfolioTitleMax {
		return apperr.Validation("title must be <= 80 characters")
	}
	if utf8.RuneCountInString(description) > portfolioDescriptionMax {
		return apperr.Validation("description must be <= 1000 characters")
	}
	if utf8.RuneCountInString(category) > portfolioCategoryMax {
		return apperr.Validation("category must be <= 40 characters")
	}
	fields := map[string]string{}
	if title != "" {
		fields["title"] = title
	}
	if description != "" {
		fields["description"] = description
	}
	if category != "" {
		fields["category"] = category
	}
	if len(fields) == 0 {
		return nil
	}
	return moderation.ValidateFields(fields)
}

// planPortfolioReorder validates that orderedIDs is a permutation of ownedIDs.
func planPortfolioReorder(ownedIDs, orderedIDs []uuid.UUID) error {
	if len(ownedIDs) != len(orderedIDs) {
		return apperr.Validation("order must include every portfolio item exactly once")
	}
	owned := make(map[uuid.UUID]struct{}, len(ownedIDs))
	for _, id := range ownedIDs {
		owned[id] = struct{}{}
	}
	seen := make(map[uuid.UUID]struct{}, len(orderedIDs))
	for _, id := range orderedIDs {
		if _, ok := owned[id]; !ok {
			return apperr.Forbidden("access denied")
		}
		if _, dup := seen[id]; dup {
			return apperr.Validation("order contains duplicate ids")
		}
		seen[id] = struct{}{}
	}
	return nil
}

func (s *Service) fetchPortfolioMedia(ctx context.Context, mediaID uuid.UUID) (*portfolioMediaMeta, error) {
	if s.mediaURL == "" || s.internalToken == "" {
		// Soft-skip when media service is not wired (dev/tests); ownership still enforced via master profile.
		return &portfolioMediaMeta{ContentType: "image/jpeg"}, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.mediaURL+"/v1/internal/media/"+mediaID.String(), nil)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode == http.StatusNotFound {
		return nil, apperr.NotFound("media not found")
	}
	if resp.StatusCode >= 300 {
		return nil, apperr.Internal(fmt.Errorf("media status %d: %s", resp.StatusCode, string(body)))
	}
	var parsed struct {
		OwnerUserID string `json:"owner_user_id"`
		Purpose     string `json:"purpose"`
		ContentType string `json:"content_type"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, apperr.Internal(err)
	}
	owner, err := uuid.Parse(parsed.OwnerUserID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return &portfolioMediaMeta{
		OwnerUserID: owner,
		Purpose:     parsed.Purpose,
		ContentType: parsed.ContentType,
	}, nil
}

func (s *Service) assertPortfolioMediaOwned(ctx context.Context, userID, mediaID uuid.UUID) (string, error) {
	meta, err := s.fetchPortfolioMedia(ctx, mediaID)
	if err != nil {
		return "", err
	}
	if meta.OwnerUserID != uuid.Nil && meta.OwnerUserID != userID {
		return "", apperr.Forbidden("media does not belong to caller")
	}
	purpose := strings.TrimSpace(meta.Purpose)
	if purpose != "" && purpose != "portfolio" {
		return "", apperr.Validation("media purpose must be portfolio")
	}
	return mediaTypeFromContentType(meta.ContentType), nil
}

func (s *Service) ListMyPortfolio(ctx context.Context, userID uuid.UUID, category string) ([]domain.PortfolioItem, error) {
	m, err := s.store.GetMasterByUser(ctx, userID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if m == nil {
		return nil, apperr.NotFound("master profile not found")
	}
	items, err := s.store.ListPortfolioByMaster(ctx, m.ID, category)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.PortfolioItem{}
	}
	return items, nil
}

func (s *Service) AddPortfolioItem(ctx context.Context, in AddPortfolioInput) (*domain.PortfolioItem, error) {
	m, err := s.store.GetMasterByUser(ctx, in.UserID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if m == nil {
		return nil, apperr.NotFound("master profile not found")
	}
	if in.MediaID == uuid.Nil {
		return nil, apperr.Validation("media_id is required")
	}
	title := normalizePortfolioTitle(in.Title, in.Caption)
	description := strings.TrimSpace(in.Description)
	category := strings.TrimSpace(in.Category)
	caption := strings.TrimSpace(in.Caption)
	if caption == "" {
		caption = title
	}
	if err := validatePortfolioFields(title, description, category); err != nil {
		return nil, err
	}
	mediaType, err := s.assertPortfolioMediaOwned(ctx, in.UserID, in.MediaID)
	if err != nil {
		return nil, err
	}
	sortOrder := 0
	if in.SortOrder != nil {
		sortOrder = *in.SortOrder
	} else {
		existing, listErr := s.store.ListPortfolioByMaster(ctx, m.ID, "")
		if listErr != nil {
			return nil, apperr.Internal(listErr)
		}
		sortOrder = len(existing)
	}
	now := s.now().UTC()
	item := domain.PortfolioItem{
		ID: ids.New(), MasterID: m.ID, MediaID: in.MediaID,
		Caption: caption, Title: title, Description: description, Category: category,
		MediaType: mediaType, SortOrder: sortOrder, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.store.InsertPortfolioItem(ctx, item); err != nil {
		return nil, apperr.Internal(err)
	}
	return &item, nil
}

func (s *Service) UpdatePortfolioItem(ctx context.Context, in UpdatePortfolioInput) (*domain.PortfolioItem, error) {
	m, err := s.store.GetMasterByUser(ctx, in.UserID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if m == nil {
		return nil, apperr.NotFound("master profile not found")
	}
	item, err := s.store.GetPortfolioItem(ctx, in.ItemID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if item == nil {
		return nil, apperr.NotFound("portfolio item not found")
	}
	if item.MasterID != m.ID {
		return nil, apperr.Forbidden("access denied")
	}
	if in.MediaID != nil {
		mediaType, err := s.assertPortfolioMediaOwned(ctx, in.UserID, *in.MediaID)
		if err != nil {
			return nil, err
		}
		item.MediaID = *in.MediaID
		item.MediaType = mediaType
	}
	if in.Caption != nil {
		item.Caption = strings.TrimSpace(*in.Caption)
	}
	if in.Title != nil {
		item.Title = strings.TrimSpace(*in.Title)
	}
	if in.Description != nil {
		item.Description = strings.TrimSpace(*in.Description)
	}
	if in.Category != nil {
		item.Category = strings.TrimSpace(*in.Category)
	}
	if in.SortOrder != nil {
		item.SortOrder = *in.SortOrder
	}
	// Keep caption as a legacy mirror of title when title is set and caption empty.
	if item.Title == "" && item.Caption != "" {
		item.Title = item.Caption
	}
	if item.Caption == "" && item.Title != "" {
		item.Caption = item.Title
	}
	if err := validatePortfolioFields(item.Title, item.Description, item.Category); err != nil {
		return nil, err
	}
	item.UpdatedAt = s.now().UTC()
	if err := s.store.UpdatePortfolioItem(ctx, *item); err != nil {
		return nil, apperr.Internal(err)
	}
	return item, nil
}

func (s *Service) DeletePortfolioItem(ctx context.Context, userID, itemID uuid.UUID) error {
	m, err := s.store.GetMasterByUser(ctx, userID)
	if err != nil {
		return apperr.Internal(err)
	}
	if m == nil {
		return apperr.NotFound("master profile not found")
	}
	item, err := s.store.GetPortfolioItem(ctx, itemID)
	if err != nil {
		return apperr.Internal(err)
	}
	if item == nil {
		return apperr.NotFound("portfolio item not found")
	}
	if item.MasterID != m.ID {
		return apperr.Forbidden("access denied")
	}
	if err := s.store.DeletePortfolioItem(ctx, itemID); err != nil {
		return apperr.Internal(err)
	}
	return nil
}

func (s *Service) ReorderMyPortfolio(ctx context.Context, userID uuid.UUID, orderedIDs []uuid.UUID) error {
	m, err := s.store.GetMasterByUser(ctx, userID)
	if err != nil {
		return apperr.Internal(err)
	}
	if m == nil {
		return apperr.NotFound("master profile not found")
	}
	existing, err := s.store.ListPortfolioByMaster(ctx, m.ID, "")
	if err != nil {
		return apperr.Internal(err)
	}
	owned := make([]uuid.UUID, 0, len(existing))
	for _, it := range existing {
		owned = append(owned, it.ID)
	}
	if err := planPortfolioReorder(owned, orderedIDs); err != nil {
		return err
	}
	if err := s.store.ReorderPortfolioItems(ctx, m.ID, orderedIDs); err != nil {
		return apperr.Internal(err)
	}
	return nil
}

func (s *Service) ListMasterPortfolio(ctx context.Context, masterID uuid.UUID, category string) ([]domain.PortfolioItem, error) {
	m, err := s.store.GetMaster(ctx, masterID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if m == nil || !m.Published {
		return nil, apperr.NotFound("master not found")
	}
	visible, err := s.isMasterPubliclyVisible(ctx, *m)
	if err != nil {
		return nil, err
	}
	if !visible {
		return nil, apperr.NotFound("master not found")
	}
	items, err := s.store.ListPortfolioByMaster(ctx, m.ID, category)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.PortfolioItem{}
	}
	return items, nil
}
