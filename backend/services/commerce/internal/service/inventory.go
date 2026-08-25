package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

func (s *Service) requireLocationRead(ctx context.Context, actor uuid.UUID, loc *domain.StockLocation) error {
	if err := s.requireAnyMembership(ctx, loc.OrganizationID, actor); err != nil {
		return err
	}
	if loc.Kind == domain.LocationMaster {
		if loc.OwnerUserID == nil || *loc.OwnerUserID != actor {
			return apperr.Forbidden("master inventory is private")
		}
	}
	return nil
}

func (s *Service) requireLocationWrite(ctx context.Context, actor uuid.UUID, loc *domain.StockLocation) error {
	if loc.Kind == domain.LocationMaster {
		if loc.OwnerUserID == nil || *loc.OwnerUserID != actor {
			return apperr.Forbidden("master inventory is private")
		}
		return s.requireMembership(ctx, loc.OrganizationID, actor, "owner", "admin", "master")
	}
	return s.requireMembership(ctx, loc.OrganizationID, actor, "owner", "admin", "master")
}

func (s *Service) EnsureMasterLocation(ctx context.Context, actor, orgID uuid.UUID) (*domain.StockLocation, error) {
	if orgID == uuid.Nil {
		return nil, apperr.Validation("organization_id is required")
	}
	if err := s.requireMembership(ctx, orgID, actor, "owner", "admin", "master"); err != nil {
		return nil, err
	}
	loc, err := s.store.GetOrCreateMasterLocation(ctx, orgID, actor, "Мой склад")
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if loc == nil {
		return nil, apperr.Internal(fmt.Errorf("failed to ensure master location"))
	}
	return loc, nil
}

func (s *Service) ListMyInventory(ctx context.Context, actor, orgID uuid.UUID) (*domain.StockLocation, []domain.StockBalanceView, error) {
	loc, err := s.EnsureMasterLocation(ctx, actor, orgID)
	if err != nil {
		return nil, nil, err
	}
	items, err := s.store.ListBalancesByLocation(ctx, loc.ID)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	incoming, _ := s.store.IncomingByProduct(ctx, loc.OrganizationID)
	for i := range items {
		items[i].QtyIncoming = incoming[items[i].ProductID]
	}
	if items == nil {
		items = []domain.StockBalanceView{}
	}
	return loc, items, nil
}

func (s *Service) GetMyInventoryItem(ctx context.Context, actor, orgID, productID uuid.UUID) (*domain.StockLocation, *domain.StockBalanceView, []domain.StockMovement, error) {
	loc, err := s.EnsureMasterLocation(ctx, actor, orgID)
	if err != nil {
		return nil, nil, nil, err
	}
	if productID == uuid.Nil {
		return nil, nil, nil, apperr.Validation("product_id is required")
	}
	view, err := s.store.GetBalanceView(ctx, loc.ID, productID)
	if err != nil {
		return nil, nil, nil, apperr.Internal(err)
	}
	if view == nil {
		p, err := s.getProductOrErr(ctx, productID)
		if err != nil {
			return nil, nil, nil, err
		}
		view = &domain.StockBalanceView{
			StockBalance: domain.StockBalance{LocationID: loc.ID, ProductID: productID},
			ProductName:  p.Name, ProductBrand: p.Brand, ProductSKU: p.SKU,
			MinStock: p.MinStock, PriceMinor: p.PriceMinor, Currency: p.Currency,
			PhotoMediaID: p.PhotoMediaID, Unit: p.Unit, VolumeLabel: p.VolumeLabel,
			Status: domain.StockStatus(0, 0, p.MinStock),
		}
	}
	movements, err := s.store.ListMovementsByProduct(ctx, loc.ID, productID, 80)
	if err != nil {
		return nil, nil, nil, apperr.Internal(err)
	}
	return loc, view, movements, nil
}

func (s *Service) ListMyMovements(ctx context.Context, actor, orgID uuid.UUID, productID *uuid.UUID) (*domain.StockLocation, []domain.StockMovement, error) {
	loc, err := s.EnsureMasterLocation(ctx, actor, orgID)
	if err != nil {
		return nil, nil, err
	}
	var items []domain.StockMovement
	if productID != nil && *productID != uuid.Nil {
		items, err = s.store.ListMovementsByProduct(ctx, loc.ID, *productID, 80)
	} else {
		items, err = s.store.ListMovements(ctx, loc.ID, 80)
	}
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.StockMovement{}
	}
	return loc, items, nil
}

type PendingReceipt struct {
	Order domain.SupplierOrder
	Items []domain.SupplierOrderItem
}

func (s *Service) ListMyPendingReceipts(ctx context.Context, actor, orgID uuid.UUID) ([]PendingReceipt, error) {
	loc, err := s.EnsureMasterLocation(ctx, actor, orgID)
	if err != nil {
		return nil, err
	}
	orders, err := s.store.ListPendingBuyerOrders(ctx, orgID, loc.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	out := make([]PendingReceipt, 0, len(orders))
	for _, o := range orders {
		items, err := s.store.ListOrderItems(ctx, o.ID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if items == nil {
			items = []domain.SupplierOrderItem{}
		}
		out = append(out, PendingReceipt{Order: o, Items: items})
	}
	return out, nil
}

type ConsumeStockInput struct {
	OrganizationID uuid.UUID
	ProductID      uuid.UUID
	Qty            float64
	AppointmentID  *uuid.UUID
	ServiceID      *uuid.UUID
	IdempotencyKey string
	Reason         string
}

func (s *Service) ConsumeMyStock(ctx context.Context, actor uuid.UUID, in ConsumeStockInput) (*domain.StockMovement, error) {
	if in.ProductID == uuid.Nil {
		return nil, apperr.Validation("product_id is required")
	}
	if in.Qty <= 0 {
		return nil, apperr.Validation("qty must be positive")
	}
	loc, err := s.EnsureMasterLocation(ctx, actor, in.OrganizationID)
	if err != nil {
		return nil, err
	}
	if _, err := s.getProductOrErr(ctx, in.ProductID); err != nil {
		return nil, err
	}
	key := strings.TrimSpace(in.IdempotencyKey)
	if key != "" {
		existing, err := s.store.GetMovementByIdempotencyKey(ctx, key)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if existing != nil {
			if existing.LocationID != loc.ID || existing.ProductID != in.ProductID {
				return nil, apperr.Conflict("idempotency_key already used")
			}
			return existing, nil
		}
	}
	reason := strings.TrimSpace(in.Reason)
	if reason == "" {
		reason = "расход по услуге"
	}
	refType := "inventory_consume"
	var refID *uuid.UUID
	if in.AppointmentID != nil && *in.AppointmentID != uuid.Nil {
		refType = "appointment"
		refID = in.AppointmentID
	} else if in.ServiceID != nil && *in.ServiceID != uuid.Nil {
		refType = "service"
		refID = in.ServiceID
	}
	m := domain.StockMovement{
		ID: ids.New(), LocationID: loc.ID, ProductID: in.ProductID,
		Kind: domain.MovementConsumption, Qty: -in.Qty, Reason: reason,
		ActorUserID: actor, RefType: refType, RefID: refID,
		IdempotencyKey: key, CreatedAt: s.now().UTC(),
	}
	out, err := s.store.CreateMovement(ctx, m)
	if err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return out, nil
}

type AdjustStockInput struct {
	OrganizationID uuid.UUID
	ProductID      uuid.UUID
	Qty            float64
	Reason         string
}

func (s *Service) AdjustMyStock(ctx context.Context, actor uuid.UUID, in AdjustStockInput) (*domain.StockMovement, error) {
	if in.ProductID == uuid.Nil {
		return nil, apperr.Validation("product_id is required")
	}
	if in.Qty == 0 {
		return nil, apperr.Validation("qty must be non-zero")
	}
	reason := strings.TrimSpace(in.Reason)
	if reason == "" {
		return nil, apperr.Validation("reason is required")
	}
	loc, err := s.EnsureMasterLocation(ctx, actor, in.OrganizationID)
	if err != nil {
		return nil, err
	}
	if _, err := s.getProductOrErr(ctx, in.ProductID); err != nil {
		return nil, err
	}
	m := domain.StockMovement{
		ID: ids.New(), LocationID: loc.ID, ProductID: in.ProductID,
		Kind: domain.MovementAdjust, Qty: in.Qty, Reason: reason,
		ActorUserID: actor, CreatedAt: s.now().UTC(),
	}
	out, err := s.store.CreateMovement(ctx, m)
	if err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return out, nil
}

func (s *Service) AcceptSupplierOrder(ctx context.Context, actor, orderID uuid.UUID, accepted []AcceptItemInput) (*domain.SupplierOrder, []domain.SupplierOrderItem, error) {
	if len(accepted) == 0 {
		return nil, nil, apperr.Validation("at least one item is required")
	}
	o, err := s.getOrderOrErr(ctx, orderID)
	if err != nil {
		return nil, nil, err
	}
	if err := s.requireMembership(ctx, o.BuyerOrgID, actor, "owner", "admin", "master"); err != nil {
		return nil, nil, err
	}
	if o.Status == domain.OrderStatusAcceptedFull {
		items, err := s.OrderItems(ctx, orderID)
		if err != nil {
			return nil, nil, err
		}
		return o, items, nil
	}
	if !acceptableAcceptStatuses[o.Status] {
		return nil, nil, apperr.Conflict("order is not ready to be accepted")
	}
	items := make([]store.AcceptItem, 0, len(accepted))
	for _, it := range accepted {
		if it.ProductID == uuid.Nil {
			return nil, nil, apperr.Validation("product_id is required")
		}
		if it.QtyAccepted < 0 || it.QtyDamaged < 0 || it.QtyRejected < 0 {
			return nil, nil, apperr.Validation("qty_damaged and qty_rejected must not be negative")
		}
		if it.QtyAccepted+it.QtyDamaged+it.QtyRejected <= 1e-9 {
			return nil, nil, apperr.Validation("at least one of qty_accepted, qty_damaged, qty_rejected must be positive")
		}
		items = append(items, store.AcceptItem{
			ProductID: it.ProductID, QtyAccepted: it.QtyAccepted,
			QtyDamaged: it.QtyDamaged, QtyRejected: it.QtyRejected,
		})
	}
	outOrder, outItems, err := s.store.AcceptOrder(ctx, orderID, actor, items, s.now().UTC())
	if err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, nil, ae
		}
		return nil, nil, apperr.Internal(err)
	}
	return outOrder, outItems, nil
}
