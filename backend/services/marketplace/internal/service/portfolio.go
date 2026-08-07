package service

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type AddPortfolioInput struct {
	UserID    uuid.UUID
	MediaID   uuid.UUID
	Caption   string
	SortOrder int
}

func (s *Service) ListMyPortfolio(ctx context.Context, userID uuid.UUID) ([]domain.PortfolioItem, error) {
	m, err := s.store.GetMasterByUser(ctx, userID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if m == nil {
		return nil, apperr.NotFound("master profile not found")
	}
	items, err := s.store.ListPortfolioByMaster(ctx, m.ID)
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
	item := domain.PortfolioItem{
		ID: ids.New(), MasterID: m.ID, MediaID: in.MediaID,
		Caption: strings.TrimSpace(in.Caption), SortOrder: in.SortOrder,
		CreatedAt: s.now().UTC(),
	}
	if err := s.store.InsertPortfolioItem(ctx, item); err != nil {
		return nil, apperr.Internal(err)
	}
	return &item, nil
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

func (s *Service) ListMasterPortfolio(ctx context.Context, masterID uuid.UUID) ([]domain.PortfolioItem, error) {
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
	items, err := s.store.ListPortfolioByMaster(ctx, m.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.PortfolioItem{}
	}
	return items, nil
}
