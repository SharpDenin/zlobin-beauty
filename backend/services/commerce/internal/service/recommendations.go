package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

func hasMasterJWTRole(roles []string) bool {
	for _, r := range roles {
		if r == "master" || r == "salon_owner" || r == "system_admin" {
			return true
		}
	}
	return false
}

func (s *Service) requireMasterActor(ctx context.Context, actor uuid.UUID, jwtRoles []string, productOrgID uuid.UUID) error {
	if hasMasterJWTRole(jwtRoles) {
		return nil
	}
	if err := s.requireMembership(ctx, productOrgID, actor, "owner", "master"); err == nil {
		return nil
	}
	return apperr.Forbidden("master access required")
}

type CreateRecommendationInput struct {
	MasterUserID uuid.UUID
	JWTRoles     []string
	ProductID    uuid.UUID
	ClientUserID *uuid.UUID
	Comment      string
	ExpiresAt    *time.Time
}

func (s *Service) CreateRecommendation(ctx context.Context, in CreateRecommendationInput) (*domain.ProductRecommendation, error) {
	p, err := s.store.GetProduct(ctx, in.ProductID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if p == nil {
		return nil, apperr.NotFound("product not found")
	}
	if err := s.requireMasterActor(ctx, in.MasterUserID, in.JWTRoles, p.OrganizationID); err != nil {
		return nil, err
	}
	if in.ExpiresAt != nil && in.ExpiresAt.Before(s.now()) {
		return nil, apperr.Validation("expires_at must be in the future")
	}
	r := domain.ProductRecommendation{
		ID: ids.New(), MasterUserID: in.MasterUserID, ProductID: in.ProductID,
		ClientUserID: in.ClientUserID, Comment: strings.TrimSpace(in.Comment),
		ExpiresAt: in.ExpiresAt, CreatedAt: s.now().UTC(),
	}
	if err := s.store.InsertRecommendation(ctx, r); err != nil {
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "unique") {
			return nil, apperr.Conflict("recommendation already exists")
		}
		return nil, apperr.Internal(err)
	}
	return &r, nil
}

func (s *Service) ListMyRecommendations(ctx context.Context, masterUserID uuid.UUID) ([]domain.ProductRecommendation, error) {
	items, err := s.store.ListRecommendationsByMaster(ctx, masterUserID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.ProductRecommendation{}
	}
	return items, nil
}

func (s *Service) DeleteRecommendation(ctx context.Context, masterUserID, id uuid.UUID) error {
	r, err := s.store.GetRecommendation(ctx, id)
	if err != nil {
		return apperr.Internal(err)
	}
	if r == nil {
		return apperr.NotFound("recommendation not found")
	}
	if r.MasterUserID != masterUserID {
		return apperr.Forbidden("access denied")
	}
	if err := s.store.DeleteRecommendation(ctx, id); err != nil {
		return apperr.Internal(err)
	}
	return nil
}

func (s *Service) ListShopRecommendations(ctx context.Context, clientUserID uuid.UUID) ([]domain.ShopRecommendation, error) {
	items, err := s.store.ListShopRecommendations(ctx, clientUserID, s.now().UTC())
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.ShopRecommendation{}
	}
	return items, nil
}
