package service

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/adminaudit"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func (s *Service) WithIdentity(identityURL string) *Service {
	s.identityURL = strings.TrimRight(identityURL, "/")
	return s
}

func (s *Service) AdminListProducts(ctx context.Context, f store.ProductListFilter) ([]store.AdminProduct, int, error) {
	items, err := s.store.ListProductsAdmin(ctx, f)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	total, err := s.store.CountProductsAdmin(ctx, f)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	return items, total, nil
}

func (s *Service) AdminGetProduct(ctx context.Context, id uuid.UUID) (*store.AdminProduct, error) {
	item, err := s.store.GetProductAdmin(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if item == nil {
		return nil, apperr.NotFound("product not found")
	}
	return item, nil
}

func (s *Service) AdminSetProductPublished(ctx context.Context, actor, id uuid.UUID, published bool) (*store.AdminProduct, error) {
	item, err := s.store.GetProductAdmin(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if item == nil {
		return nil, apperr.NotFound("product not found")
	}
	before := item.Published
	now := s.now().UTC()
	if err := s.store.SetProductPublished(ctx, id, published, now); err != nil {
		return nil, apperr.Internal(err)
	}
	item.Published = published
	item.UpdatedAt = now
	action := "product.unpublished"
	if published {
		action = "product.published"
	}
	adminaudit.Record(ctx, s.identityURL, s.internalToken, actor, action, "product", &id, map[string]any{
		"before": before, "after": published,
	})
	return item, nil
}

func (s *Service) AdminListOrders(ctx context.Context, f store.OrderListFilter) ([]domain.ClientOrder, int, error) {
	items, err := s.store.ListOrdersAdmin(ctx, f)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	total, err := s.store.CountOrdersAdmin(ctx, f)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	return items, total, nil
}

func (s *Service) AdminGetOrder(ctx context.Context, id uuid.UUID) (*domain.ClientOrder, []domain.ClientOrderItem, error) {
	o, err := s.store.GetClientOrder(ctx, id)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if o == nil {
		return nil, nil, apperr.NotFound("order not found")
	}
	items, err := s.store.ListClientOrderItems(ctx, id)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.ClientOrderItem{}
	}
	return o, items, nil
}

func (s *Service) AdminCommerceStats(ctx context.Context) (store.CommerceStats, error) {
	st, err := s.store.CommerceStats(ctx)
	if err != nil {
		return st, apperr.Internal(err)
	}
	return st, nil
}
