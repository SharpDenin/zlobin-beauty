package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

const (
	RecommendationContextProduct = "product"
	RecommendationContextService = "service"
	RecommendationContextSearch  = "search"
	RecommendationContextRelated = "related"

	EmptyReasonProduct = "Для этого материала нет сохранённой рекомендации"
	EmptyReasonService = "Для этой услуги нет сохранённых материалов"
	EmptyReasonGeneric = "Нет сохранённых рекомендаций"
)

type KnowledgeRecommendInput struct {
	ViewerID       uuid.UUID
	AccessToken    string
	OrganizationID uuid.UUID
	ServiceID      uuid.UUID
	AppointmentID  uuid.UUID
	ProductIDs     []uuid.UUID
	Query          string
}

type KnowledgeRecommendation struct {
	Article domain.KnowledgeArticle
	Context string
}

type KnowledgeRecommendResult struct {
	Items       []KnowledgeRecommendation
	EmptyReason string
	ServiceID   uuid.UUID
	ProductIDs  []uuid.UUID
}

func UniqueUUIDs(ids []uuid.UUID) []uuid.UUID {
	seen := map[uuid.UUID]struct{}{}
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
	return out
}

func EmptyRecommendationReason(hasProduct, hasService, hasQuery bool) string {
	if hasProduct {
		return EmptyReasonProduct
	}
	if hasService {
		return EmptyReasonService
	}
	if hasQuery {
		return EmptyReasonGeneric
	}
	return EmptyReasonGeneric
}

func RecommendationContext(a domain.KnowledgeArticle, requestedProducts []uuid.UUID, serviceProducts []uuid.UUID, query string) string {
	for _, pid := range requestedProducts {
		if containsUUID(a.ProductIDs, pid) || (a.ProductID != nil && *a.ProductID == pid) {
			return RecommendationContextProduct
		}
	}
	for _, pid := range serviceProducts {
		if containsUUID(a.ProductIDs, pid) || (a.ProductID != nil && *a.ProductID == pid) {
			return RecommendationContextService
		}
	}
	q := strings.ToLower(strings.TrimSpace(query))
	if q != "" && (strings.Contains(strings.ToLower(a.Title), q) || strings.Contains(strings.ToLower(a.Category), q) || strings.Contains(strings.ToLower(a.Brand), q)) {
		return RecommendationContextSearch
	}
	return RecommendationContextRelated
}

func (s *Service) RecommendKnowledge(ctx context.Context, in KnowledgeRecommendInput) (*KnowledgeRecommendResult, error) {
	if in.ViewerID == uuid.Nil {
		return nil, apperr.Unauthorized("authentication required")
	}
	productIDs := UniqueUUIDs(in.ProductIDs)
	serviceID := in.ServiceID
	orgID := in.OrganizationID
	if in.AppointmentID != uuid.Nil {
		meta, err := s.fetchAppointmentMeta(ctx, in.AccessToken, in.AppointmentID)
		if err != nil {
			return nil, err
		}
		if serviceID == uuid.Nil {
			serviceID = meta.ServiceID
		}
		if orgID == uuid.Nil {
			orgID = meta.OrganizationID
		}
	}
	var serviceProducts []uuid.UUID
	if serviceID != uuid.Nil && orgID != uuid.Nil {
		ids, err := s.fetchNormProductIDs(ctx, in.AccessToken, orgID, serviceID)
		if err != nil {
			return nil, err
		}
		serviceProducts = ids
		productIDs = UniqueUUIDs(append(productIDs, ids...))
	}
	q := strings.TrimSpace(in.Query)
	out := &KnowledgeRecommendResult{
		Items:      []KnowledgeRecommendation{},
		ServiceID:  serviceID,
		ProductIDs: productIDs,
	}
	if len(productIDs) == 0 && q == "" {
		out.EmptyReason = EmptyRecommendationReason(false, serviceID != uuid.Nil, false)
		return out, nil
	}
	list, err := s.ListKnowledge(ctx, KnowledgeListQuery{
		Query:         q,
		ProductIDs:    productIDs,
		ViewerID:      &in.ViewerID,
		PublishedOnly: true,
		Sort:          "recommended",
		Limit:         12,
	})
	if err != nil {
		return nil, err
	}
	requested := UniqueUUIDs(in.ProductIDs)
	for _, a := range list.Items {
		out.Items = append(out.Items, KnowledgeRecommendation{
			Article: a,
			Context: RecommendationContext(a, requested, serviceProducts, q),
		})
	}
	if len(out.Items) == 0 {
		out.EmptyReason = EmptyRecommendationReason(len(requested) > 0, serviceID != uuid.Nil && len(requested) == 0, q != "")
	}
	return out, nil
}

type appointmentMeta struct {
	ServiceID      uuid.UUID
	OrganizationID uuid.UUID
}

func (s *Service) fetchAppointmentMeta(ctx context.Context, accessToken string, appointmentID uuid.UUID) (*appointmentMeta, error) {
	if s.bookingURL == "" {
		return nil, apperr.Validation("appointment context is unavailable")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.bookingURL+"/v1/appointments/"+appointmentID.String(), nil)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if accessToken != "" {
		req.Header.Set("Authorization", "Bearer "+accessToken)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, apperr.Internal(fmt.Errorf("booking appointment: %w", err))
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusForbidden {
		return nil, apperr.Forbidden("appointment is not available")
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, apperr.NotFound("appointment not found")
	}
	if resp.StatusCode >= 300 {
		return nil, apperr.Internal(fmt.Errorf("booking appointment status %d", resp.StatusCode))
	}
	var parsed struct {
		ServiceID      string `json:"service_id"`
		OrganizationID string `json:"organization_id"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, apperr.Internal(err)
	}
	sid, err1 := uuid.Parse(parsed.ServiceID)
	oid, err2 := uuid.Parse(parsed.OrganizationID)
	if err1 != nil || err2 != nil {
		return nil, apperr.Validation("appointment is missing service context")
	}
	return &appointmentMeta{ServiceID: sid, OrganizationID: oid}, nil
}

func (s *Service) fetchNormProductIDs(ctx context.Context, accessToken string, orgID, serviceID uuid.UUID) ([]uuid.UUID, error) {
	if s.commerceURL == "" {
		return nil, nil
	}
	url := fmt.Sprintf("%s/v1/commerce/norms?organization_id=%s&service_id=%s", s.commerceURL, orgID.String(), serviceID.String())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if accessToken != "" {
		req.Header.Set("Authorization", "Bearer "+accessToken)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, apperr.Internal(fmt.Errorf("commerce norms: %w", err))
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusForbidden {
		return nil, apperr.Forbidden("service materials are not available")
	}
	if resp.StatusCode >= 300 {
		return nil, apperr.Internal(fmt.Errorf("commerce norms status %d", resp.StatusCode))
	}
	var parsed struct {
		Items []struct {
			ProductID string `json:"product_id"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, apperr.Internal(err)
	}
	ids := make([]uuid.UUID, 0, len(parsed.Items))
	for _, it := range parsed.Items {
		id, err := uuid.Parse(it.ProductID)
		if err != nil {
			continue
		}
		ids = append(ids, id)
	}
	return UniqueUUIDs(ids), nil
}
