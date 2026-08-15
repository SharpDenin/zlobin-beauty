package service

import (
	"context"
	"encoding/json"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/auth"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

const (
	knowledgeListLimit      = 100
	knowledgeRankFetchLimit = 500
)

type KnowledgeInput struct {
	ActorUserID        uuid.UUID
	ActorName          string
	OrgID              *uuid.UUID
	Title              string
	Category           string
	Content            string
	ContentFormat      string
	CoverMediaID       *uuid.UUID
	ClearCover         bool
	ReadingTimeMinutes int
	Brand              string
	ProductID          *uuid.UUID
	ProductIDs         []uuid.UUID
	SetProductIDs      bool
	CategoryIDs        []uuid.UUID
	SetCategoryIDs     bool
	Published          *bool
	Status             string
}

type KnowledgeListQuery struct {
	Category          string
	Brand             string
	Query             string
	SupplierOrgID     *uuid.UUID
	ProductID         *uuid.UUID
	ProductCategoryID *uuid.UUID
	ViewerID          *uuid.UUID
	AuthorUserID      *uuid.UUID
	FavoritesOnly     bool
	PublishedOnly     bool
}

// KnowledgeRankInput is the deterministic ranking signal set. No ML / embeddings.
type KnowledgeRankInput struct {
	ExactProductMatch bool
	CategoryMatch     bool
	BrandMatch        bool
	TitleMatch        bool
	ViewCount         int
	PublishedAt       *time.Time
	CreatedAt         time.Time
	Now               time.Time
}

func KnowledgeRankScore(in KnowledgeRankInput) float64 {
	score := 0.0
	if in.ExactProductMatch {
		score += 100
	}
	if in.CategoryMatch {
		score += 50
	}
	if in.BrandMatch {
		score += 30
	}
	if in.TitleMatch {
		score += 20
	}
	vc := in.ViewCount
	if vc < 0 {
		vc = 0
	}
	score += math.Log(1+float64(vc)) * 5
	score += knowledgeRecencyScore(in.PublishedAt, in.CreatedAt, in.Now)
	return score
}

func knowledgeRecencyScore(publishedAt *time.Time, createdAt, now time.Time) float64 {
	t := createdAt
	if publishedAt != nil {
		t = *publishedAt
	}
	if t.IsZero() {
		return 0
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	days := now.Sub(t).Hours() / 24
	if days < 0 {
		days = 0
	}
	return 10.0 / (1.0 + days/30.0)
}

func shouldRankKnowledge(q KnowledgeListQuery) bool {
	return strings.TrimSpace(q.Query) != "" || q.ProductID != nil || q.ProductCategoryID != nil
}

func rankKnowledgeArticles(items []domain.KnowledgeArticle, q KnowledgeListQuery, now time.Time) []domain.KnowledgeArticle {
	if !shouldRankKnowledge(q) || len(items) < 2 {
		return items
	}
	type scored struct {
		a     domain.KnowledgeArticle
		score float64
	}
	needle := strings.ToLower(strings.TrimSpace(q.Query))
	brandFilter := strings.TrimSpace(q.Brand)
	ranked := make([]scored, len(items))
	for i, a := range items {
		in := KnowledgeRankInput{
			ViewCount:   a.ViewCount,
			PublishedAt: a.PublishedAt,
			CreatedAt:   a.CreatedAt,
			Now:         now,
		}
		if q.ProductID != nil {
			in.ExactProductMatch = containsUUID(a.ProductIDs, *q.ProductID) || (a.ProductID != nil && *a.ProductID == *q.ProductID)
		}
		if q.ProductCategoryID != nil {
			in.CategoryMatch = containsUUID(a.CategoryIDs, *q.ProductCategoryID)
		}
		if brandFilter != "" && strings.EqualFold(strings.TrimSpace(a.Brand), brandFilter) {
			in.BrandMatch = true
		}
		if needle != "" {
			if strings.Contains(strings.ToLower(a.Title), needle) {
				in.TitleMatch = true
			}
			if strings.Contains(strings.ToLower(a.Brand), needle) {
				in.BrandMatch = true
			}
		}
		ranked[i] = scored{a: a, score: KnowledgeRankScore(in)}
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].score != ranked[j].score {
			return ranked[i].score > ranked[j].score
		}
		return ranked[i].a.ID.String() < ranked[j].a.ID.String()
	})
	out := make([]domain.KnowledgeArticle, len(ranked))
	for i, r := range ranked {
		out[i] = r.a
	}
	return out
}

func (s *Service) ListKnowledge(ctx context.Context, q KnowledgeListQuery) ([]domain.KnowledgeArticle, error) {
	if q.FavoritesOnly && q.ViewerID == nil {
		return nil, apperr.Unauthorized("authentication required for favorites filter")
	}
	f := store.KnowledgeListFilter{
		Category:          q.Category,
		Brand:             q.Brand,
		Query:             q.Query,
		SupplierOrgID:     q.SupplierOrgID,
		ProductID:         q.ProductID,
		ProductCategoryID: q.ProductCategoryID,
		ViewerID:          q.ViewerID,
		AuthorUserID:      q.AuthorUserID,
		FavoritesOnly:     q.FavoritesOnly,
		PublishedOnly:     q.PublishedOnly,
		Limit:             knowledgeListLimit,
	}
	if shouldRankKnowledge(q) {
		f.Limit = knowledgeRankFetchLimit
	}
	items, err := s.store.ListKnowledgeArticles(ctx, f)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.KnowledgeArticle{}
	}
	items = rankKnowledgeArticles(items, q, s.now().UTC())
	if len(items) > knowledgeListLimit {
		items = items[:knowledgeListLimit]
	}
	return items, nil
}

func (s *Service) ListMyKnowledge(ctx context.Context, authorUserID uuid.UUID, q KnowledgeListQuery) ([]domain.KnowledgeArticle, error) {
	q.AuthorUserID = &authorUserID
	q.PublishedOnly = false
	if q.ViewerID == nil {
		q.ViewerID = &authorUserID
	}
	return s.ListKnowledge(ctx, q)
}

func (s *Service) GetKnowledge(ctx context.Context, id uuid.UUID, viewerID *uuid.UUID) (*domain.KnowledgeArticle, error) {
	a, err := s.store.GetKnowledgeArticleForViewer(ctx, id, viewerID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("article not found")
	}
	published := a.Status == domain.KnowledgeStatusPublished && a.Published
	if published {
		isAuthor := viewerID != nil && *viewerID == a.AuthorUserID
		if !isAuthor {
			n, incErr := s.store.IncrementKnowledgeViewCount(ctx, a.ID)
			if incErr != nil {
				return nil, apperr.Internal(incErr)
			}
			if n > 0 {
				a.ViewCount = n
			}
		}
		return a, nil
	}
	ok, err := s.canPreviewKnowledge(ctx, a, viewerID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, apperr.NotFound("article not found")
	}
	return a, nil
}

func (s *Service) CreateKnowledge(ctx context.Context, claims *auth.Claims, in KnowledgeInput) (*domain.KnowledgeArticle, error) {
	if !auth.HasRole(claims, "supplier") {
		return nil, apperr.Forbidden("supplier role required")
	}
	title := strings.TrimSpace(in.Title)
	content := strings.TrimSpace(in.Content)
	if title == "" || content == "" {
		return nil, apperr.Validation("title and content are required")
	}
	format, err := normalizeContentFormat(in.ContentFormat, content)
	if err != nil {
		return nil, err
	}
	if in.ReadingTimeMinutes < 0 {
		return nil, apperr.Validation("reading_time_minutes must be >= 0")
	}
	status, err := resolveArticleStatus(in.Status, in.Published, domain.KnowledgeStatusPublished)
	if err != nil {
		return nil, err
	}
	if in.OrgID != nil {
		if err := s.requireMembership(ctx, *in.OrgID, in.ActorUserID, "owner", "admin"); err != nil {
			return nil, err
		}
	}
	now := s.now().UTC()
	productIDs := resolveProductIDs(in)
	a := domain.KnowledgeArticle{
		ID: ids.New(), Title: title, Category: strings.TrimSpace(in.Category), Content: content,
		ContentFormat: format, CoverMediaID: in.CoverMediaID, ReadingTimeMinutes: in.ReadingTimeMinutes,
		Brand: strings.TrimSpace(in.Brand), ProductIDs: productIDs, CategoryIDs: uniqueKeep(in.CategoryIDs),
		AuthorUserID: in.ActorUserID, AuthorOrgID: in.OrgID, AuthorName: strings.TrimSpace(in.ActorName),
		CreatedAt: now, UpdatedAt: now,
	}
	applyArticleStatus(&a, status, now)
	if len(productIDs) > 0 {
		first := productIDs[0]
		a.ProductID = &first
	}
	if err := s.store.CreateKnowledgeArticle(ctx, a); err != nil {
		return nil, apperr.Internal(err)
	}
	if err := s.store.ReplaceKnowledgeProducts(ctx, a.ID, productIDs); err != nil {
		return nil, apperr.Internal(err)
	}
	if err := s.store.ReplaceKnowledgeCategories(ctx, a.ID, a.CategoryIDs); err != nil {
		return nil, apperr.Internal(err)
	}
	out, err := s.store.GetKnowledgeArticleForViewer(ctx, a.ID, &in.ActorUserID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if out == nil {
		return &a, nil
	}
	return out, nil
}

func (s *Service) UpdateKnowledge(ctx context.Context, actor uuid.UUID, id uuid.UUID, in KnowledgeInput) (*domain.KnowledgeArticle, error) {
	a, err := s.store.GetKnowledgeArticle(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("article not found")
	}
	if err := s.authorizeKnowledgeWrite(ctx, actor, a); err != nil {
		return nil, err
	}
	title := strings.TrimSpace(in.Title)
	content := strings.TrimSpace(in.Content)
	if title == "" || content == "" {
		return nil, apperr.Validation("title and content are required")
	}
	format, err := normalizeContentFormat(in.ContentFormat, content)
	if err != nil {
		return nil, err
	}
	if in.ReadingTimeMinutes < 0 {
		return nil, apperr.Validation("reading_time_minutes must be >= 0")
	}
	a.Title = title
	a.Category = strings.TrimSpace(in.Category)
	a.Content = content
	a.ContentFormat = format
	a.ReadingTimeMinutes = in.ReadingTimeMinutes
	a.Brand = strings.TrimSpace(in.Brand)
	if in.ClearCover {
		a.CoverMediaID = nil
	} else if in.CoverMediaID != nil {
		a.CoverMediaID = in.CoverMediaID
	}
	if in.OrgID != nil {
		if err := s.requireMembership(ctx, *in.OrgID, actor, "owner", "admin"); err != nil {
			return nil, err
		}
		a.AuthorOrgID = in.OrgID
	}
	if name := strings.TrimSpace(in.ActorName); name != "" {
		a.AuthorName = name
	}
	now := s.now().UTC()
	if in.Status != "" || in.Published != nil {
		status, err := resolveArticleStatus(in.Status, in.Published, a.Status)
		if err != nil {
			return nil, err
		}
		applyArticleStatus(a, status, now)
	}
	if in.SetProductIDs {
		productIDs := resolveProductIDs(in)
		a.ProductIDs = productIDs
		if len(productIDs) > 0 {
			first := productIDs[0]
			a.ProductID = &first
		} else {
			a.ProductID = nil
		}
	}
	if in.SetCategoryIDs {
		a.CategoryIDs = uniqueKeep(in.CategoryIDs)
	}
	a.UpdatedAt = now
	if err := s.store.UpdateKnowledgeArticle(ctx, *a); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	if in.SetProductIDs {
		if err := s.store.ReplaceKnowledgeProducts(ctx, a.ID, a.ProductIDs); err != nil {
			return nil, apperr.Internal(err)
		}
	}
	if in.SetCategoryIDs {
		if err := s.store.ReplaceKnowledgeCategories(ctx, a.ID, a.CategoryIDs); err != nil {
			return nil, apperr.Internal(err)
		}
	}
	out, err := s.store.GetKnowledgeArticleForViewer(ctx, a.ID, &actor)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if out == nil {
		return a, nil
	}
	return out, nil
}

func (s *Service) SetKnowledgeStatus(ctx context.Context, actor uuid.UUID, id uuid.UUID, status string) (*domain.KnowledgeArticle, error) {
	status, err := resolveArticleStatus(status, nil, "")
	if err != nil {
		return nil, err
	}
	a, err := s.store.GetKnowledgeArticle(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("article not found")
	}
	if err := s.authorizeKnowledgeWrite(ctx, actor, a); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	applyArticleStatus(a, status, now)
	a.UpdatedAt = now
	if err := s.store.UpdateKnowledgeArticle(ctx, *a); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	out, err := s.store.GetKnowledgeArticleForViewer(ctx, a.ID, &actor)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if out == nil {
		return a, nil
	}
	return out, nil
}

func (s *Service) AddKnowledgeFavorite(ctx context.Context, userID, articleID uuid.UUID) (*domain.KnowledgeArticle, error) {
	a, err := s.store.GetKnowledgeArticleForViewer(ctx, articleID, &userID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil || a.Status != domain.KnowledgeStatusPublished {
		return nil, apperr.NotFound("article not found")
	}
	if err := s.store.AddKnowledgeFavorite(ctx, userID, articleID); err != nil {
		return nil, apperr.Internal(err)
	}
	a.Favorite = true
	return a, nil
}

func (s *Service) RemoveKnowledgeFavorite(ctx context.Context, userID, articleID uuid.UUID) error {
	a, err := s.store.GetKnowledgeArticle(ctx, articleID)
	if err != nil {
		return apperr.Internal(err)
	}
	if a == nil {
		return apperr.NotFound("article not found")
	}
	if err := s.store.RemoveKnowledgeFavorite(ctx, userID, articleID); err != nil {
		return apperr.Internal(err)
	}
	return nil
}

func (s *Service) authorizeKnowledgeWrite(ctx context.Context, actor uuid.UUID, a *domain.KnowledgeArticle) error {
	if a.AuthorUserID == actor {
		return nil
	}
	if a.AuthorOrgID == nil {
		return apperr.Forbidden("only author or supplier org owner/admin can update article")
	}
	if err := s.requireMembership(ctx, *a.AuthorOrgID, actor, "owner", "admin"); err != nil {
		if ae, ok := apperr.As(err); ok && ae.Code == apperr.CodeForbidden {
			return apperr.Forbidden("only author or supplier org owner/admin can update article")
		}
		return err
	}
	return nil
}

func (s *Service) canPreviewKnowledge(ctx context.Context, a *domain.KnowledgeArticle, viewerID *uuid.UUID) (bool, error) {
	if viewerID == nil {
		return false, nil
	}
	if *viewerID == a.AuthorUserID {
		return true, nil
	}
	if a.AuthorOrgID == nil {
		return false, nil
	}
	err := s.requireMembership(ctx, *a.AuthorOrgID, *viewerID, "owner", "admin")
	if err == nil {
		return true, nil
	}
	if ae, ok := apperr.As(err); ok && ae.Code == apperr.CodeForbidden {
		return false, nil
	}
	return false, err
}

func normalizeContentFormat(format, content string) (string, error) {
	format = strings.TrimSpace(format)
	if format == "" {
		format = "plain"
	}
	switch format {
	case "plain":
		return format, nil
	case "doc_json":
		var obj map[string]any
		if err := json.Unmarshal([]byte(content), &obj); err != nil || obj == nil {
			return "", apperr.Validation("content must be a valid JSON object for doc_json")
		}
		return format, nil
	default:
		return "", apperr.Validation("content_format must be plain or doc_json")
	}
}

func resolveArticleStatus(status string, published *bool, fallback string) (string, error) {
	status = strings.TrimSpace(strings.ToLower(status))
	if status != "" {
		switch status {
		case domain.KnowledgeStatusDraft, domain.KnowledgeStatusPublished, domain.KnowledgeStatusArchived:
			return status, nil
		default:
			return "", apperr.Validation("status must be draft, published, or archived")
		}
	}
	if published != nil {
		if *published {
			return domain.KnowledgeStatusPublished, nil
		}
		if fallback == domain.KnowledgeStatusArchived {
			return domain.KnowledgeStatusArchived, nil
		}
		return domain.KnowledgeStatusDraft, nil
	}
	if fallback == "" {
		return "", apperr.Validation("status must be draft, published, or archived")
	}
	return fallback, nil
}

func applyArticleStatus(a *domain.KnowledgeArticle, status string, now time.Time) {
	a.Status = status
	a.Published = status == domain.KnowledgeStatusPublished
	switch status {
	case domain.KnowledgeStatusPublished:
		if a.PublishedAt == nil {
			t := now
			a.PublishedAt = &t
		}
		a.ArchivedAt = nil
	case domain.KnowledgeStatusArchived:
		t := now
		a.ArchivedAt = &t
	case domain.KnowledgeStatusDraft:
		a.ArchivedAt = nil
	}
}

func resolveProductIDs(in KnowledgeInput) []uuid.UUID {
	ids := append([]uuid.UUID{}, in.ProductIDs...)
	if in.ProductID != nil {
		ids = append([]uuid.UUID{*in.ProductID}, ids...)
	}
	return uniqueKeep(ids)
}

func uniqueKeep(ids []uuid.UUID) []uuid.UUID {
	seen := make(map[uuid.UUID]struct{}, len(ids))
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if id == uuid.Nil {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	if out == nil {
		return []uuid.UUID{}
	}
	return out
}

func containsUUID(ids []uuid.UUID, id uuid.UUID) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}
