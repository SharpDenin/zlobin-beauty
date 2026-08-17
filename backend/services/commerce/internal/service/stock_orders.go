package service

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/auth"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

func isProfessional(roles []string) bool {
	return auth.HasRole(&auth.Claims{Roles: roles}, "master") ||
		auth.HasRole(&auth.Claims{Roles: roles}, "supplier") ||
		auth.HasRole(&auth.Claims{Roles: roles}, "supplier_rep") ||
		auth.HasRole(&auth.Claims{Roles: roles}, "salon_owner") ||
		auth.HasRole(&auth.Claims{Roles: roles}, "salon_admin") ||
		auth.HasRole(&auth.Claims{Roles: roles}, "system_admin")
}

func (s *Service) reserveOrderStock(ctx context.Context, actor uuid.UUID, o *domain.SupplierOrder, items []domain.SupplierOrderItem) error {
	loc, err := s.store.GetOrCreateLocationByKind(ctx, o.SupplierOrgID, domain.LocationSupplier, "Склад поставщика")
	if err != nil {
		return apperr.Internal(err)
	}
	now := s.now().UTC()
	for _, it := range items {
		m := domain.StockMovement{
			ID: ids.New(), LocationID: loc.ID, ProductID: it.ProductID, Kind: domain.MovementReserve,
			Qty: it.QtyOrdered, Reason: "order reserve", ActorUserID: actor, RefType: "supplier_order", RefID: &o.ID, CreatedAt: now,
		}
		if _, err := s.store.CreateMovement(ctx, m); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) releaseOrderStock(ctx context.Context, actor uuid.UUID, o *domain.SupplierOrder) error {
	items, err := s.store.ListOrderItems(ctx, o.ID)
	if err != nil {
		return apperr.Internal(err)
	}
	loc, err := s.store.GetOrCreateLocationByKind(ctx, o.SupplierOrgID, domain.LocationSupplier, "Склад поставщика")
	if err != nil {
		return apperr.Internal(err)
	}
	now := s.now().UTC()
	for _, it := range items {
		m := domain.StockMovement{
			ID: ids.New(), LocationID: loc.ID, ProductID: it.ProductID, Kind: domain.MovementRelease,
			Qty: it.QtyOrdered, Reason: "order release", ActorUserID: actor, RefType: "supplier_order", RefID: &o.ID, CreatedAt: now,
		}
		if _, err := s.store.CreateMovement(ctx, m); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) shipOrderStock(ctx context.Context, actor uuid.UUID, o *domain.SupplierOrder) error {
	items, err := s.store.ListOrderItems(ctx, o.ID)
	if err != nil {
		return apperr.Internal(err)
	}
	loc, err := s.store.GetOrCreateLocationByKind(ctx, o.SupplierOrgID, domain.LocationSupplier, "Склад поставщика")
	if err != nil {
		return apperr.Internal(err)
	}
	now := s.now().UTC()
	for _, it := range items {
		m := domain.StockMovement{
			ID: ids.New(), LocationID: loc.ID, ProductID: it.ProductID, Kind: domain.MovementShipment,
			Qty: it.QtyOrdered, Reason: "order shipment", ActorUserID: actor, RefType: "supplier_order", RefID: &o.ID, CreatedAt: now,
		}
		if _, err := s.store.CreateMovement(ctx, m); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) SupplierAnalytics(ctx context.Context, actor, orgID uuid.UUID, from, to time.Time) (map[string]any, error) {
	if err := s.requireMembership(ctx, orgID, actor, "owner", "admin"); err != nil {
		if s.requireMembership(ctx, orgID, actor, "rep") != nil {
			return nil, err
		}
	}
	return s.store.SupplierAnalytics(ctx, orgID, from, to)
}

func (s *Service) RepAnalytics(ctx context.Context, actor, orgID uuid.UUID, from, to time.Time) (map[string]any, error) {
	if err := s.requireMembership(ctx, orgID, actor, "rep", "owner", "admin"); err != nil {
		return nil, err
	}
	return s.store.RepAnalytics(ctx, orgID, actor, from, to)
}
