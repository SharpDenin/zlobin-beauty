package service

import (
	"context"
	"strings"
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

// typedOrInternal keeps typed errors (insufficient_stock, validation, ...) and hides
// anything else behind internal_error, so raw DB text never reaches the client.
func typedOrInternal(err error) error {
	if err == nil {
		return nil
	}
	if ae, ok := apperr.As(err); ok {
		return ae
	}
	return apperr.Internal(err)
}

// reserveMovements builds the supplier-stock reservations for a new order. They are
// applied by store.CreateOrderReserving in the same transaction as the order itself,
// so an order that cannot be reserved is never persisted.
func reserveMovements(actor, orderID, locationID uuid.UUID, items []domain.SupplierOrderItem, now time.Time) []domain.StockMovement {
	out := make([]domain.StockMovement, 0, len(items))
	for _, it := range items {
		out = append(out, domain.StockMovement{
			ID: ids.New(), LocationID: locationID, ProductID: it.ProductID, Kind: domain.MovementReserve,
			Qty: it.QtyOrdered, Reason: "order reserve", ActorUserID: actor, RefType: "supplier_order", RefID: &orderID, CreatedAt: now,
		})
	}
	return out
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
			return typedOrInternal(err)
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
			return typedOrInternal(err)
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

func (s *Service) DevBackdate(ctx context.Context, actor uuid.UUID, kind string, orderID uuid.UUID, at time.Time) error {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "supplier", "supplier_order":
		o, err := s.store.GetOrder(ctx, orderID)
		if err != nil {
			return apperr.Internal(err)
		}
		if o == nil {
			return apperr.NotFound("order not found")
		}
		if err := s.requireMembership(ctx, o.SupplierOrgID, actor, "owner", "admin"); err != nil {
			return err
		}
		return s.store.BackdateSupplierOrder(ctx, orderID, at)
	case "client", "client_order":
		o, err := s.store.GetClientOrder(ctx, orderID)
		if err != nil {
			return apperr.Internal(err)
		}
		if o == nil {
			return apperr.NotFound("order not found")
		}
		if err := s.requireMembership(ctx, o.SupplierOrgID, actor, "owner", "admin"); err != nil {
			return err
		}
		return s.store.BackdateClientOrder(ctx, orderID, at)
	default:
		return apperr.Validation("kind must be supplier or client")
	}
}
