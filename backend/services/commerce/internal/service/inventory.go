package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

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

func (s *Service) SupplierNamesForMovements(ctx context.Context, movements []domain.StockMovement) map[string]string {
	out := map[string]string{}
	seen := map[uuid.UUID]struct{}{}
	for _, m := range movements {
		if m.RefType != "supplier_order" || m.RefID == nil {
			continue
		}
		if _, ok := seen[*m.RefID]; ok {
			continue
		}
		seen[*m.RefID] = struct{}{}
		o, err := s.store.GetOrder(ctx, *m.RefID)
		if err != nil || o == nil {
			continue
		}
		if name := s.organizationName(ctx, o.SupplierOrgID); name != "" {
			out[m.RefID.String()] = name
		}
	}
	return out
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
	Order           domain.SupplierOrder
	Items           []domain.SupplierOrderItem
	SupplierName    string
	AcceptanceState string
}

func (s *Service) ListMyPendingReceipts(ctx context.Context, actor, orgID uuid.UUID) ([]PendingReceipt, error) {
	return s.ListMyReceipts(ctx, actor, orgID, true)
}

func (s *Service) ListMyReceipts(ctx context.Context, actor, orgID uuid.UUID, pendingOnly bool) ([]PendingReceipt, error) {
	loc, err := s.EnsureMasterLocation(ctx, actor, orgID)
	if err != nil {
		return nil, err
	}
	orders, err := s.store.ListBuyerOrdersForLocation(ctx, orgID, loc.ID, pendingOnly)
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
		out = append(out, PendingReceipt{
			Order: o, Items: items,
			SupplierName:    s.organizationName(ctx, o.SupplierOrgID),
			AcceptanceState: domain.OrderAcceptanceState(items),
		})
	}
	return out, nil
}

func (s *Service) GetMyReceipt(ctx context.Context, actor, orgID, orderID uuid.UUID) (*PendingReceipt, error) {
	loc, err := s.EnsureMasterLocation(ctx, actor, orgID)
	if err != nil {
		return nil, err
	}
	o, err := s.getOrderOrErr(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if o.BuyerOrgID != orgID || o.LocationID != loc.ID {
		return nil, apperr.Forbidden("order does not belong to this master warehouse")
	}
	items, err := s.store.ListOrderItems(ctx, o.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.SupplierOrderItem{}
	}
	return &PendingReceipt{
		Order: *o, Items: items,
		SupplierName:    s.organizationName(ctx, o.SupplierOrgID),
		AcceptanceState: domain.OrderAcceptanceState(items),
	}, nil
}

func (s *Service) organizationName(ctx context.Context, orgID uuid.UUID) string {
	if s.organizationsURL == "" || s.internalToken == "" || orgID == uuid.Nil {
		return ""
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.organizationsURL+"/v1/internal/organizations/"+orgID.String(), nil)
	if err != nil {
		return ""
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return ""
	}
	var out struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return ""
	}
	return out.Name
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
		return nil, typedOrInternal(err)
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
		return nil, typedOrInternal(err)
	}
	return out, nil
}

func (s *Service) AcceptSupplierOrder(ctx context.Context, actor, orderID uuid.UUID, accepted []AcceptItemInput, idempotencyKey string) (*domain.SupplierOrder, []domain.SupplierOrderItem, error) {
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
	loc, err := s.getLocationOrErr(ctx, o.LocationID)
	if err != nil {
		return nil, nil, err
	}
	if err := s.requireLocationWrite(ctx, actor, loc); err != nil {
		return nil, nil, err
	}
	key := strings.TrimSpace(idempotencyKey)
	if key != "" && accepted[0].ProductID != uuid.Nil {
		for _, kind := range []string{domain.MovementReceipt, domain.MovementDamage, domain.MovementRejection} {
			existing, err := s.store.GetMovementByIdempotencyKey(ctx, domain.AcceptMovementIdempotencyKey(key, kind, accepted[0].ProductID))
			if err != nil {
				return nil, nil, apperr.Internal(err)
			}
			if existing != nil {
				if existing.LocationID != o.LocationID {
					return nil, nil, apperr.Conflict("idempotency_key already used")
				}
				items, err := s.OrderItems(ctx, orderID)
				if err != nil {
					return nil, nil, err
				}
				return o, items, nil
			}
		}
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
			return nil, nil, apperr.Validation("qty_accepted, qty_damaged and qty_rejected must not be negative")
		}
		if it.QtyAccepted+it.QtyDamaged+it.QtyRejected <= 1e-9 {
			return nil, nil, apperr.Validation("at least one of qty_accepted, qty_damaged, qty_rejected must be positive")
		}
		items = append(items, store.AcceptItem{
			ProductID: it.ProductID, QtyAccepted: it.QtyAccepted,
			QtyDamaged: it.QtyDamaged, QtyRejected: it.QtyRejected,
		})
	}
	outOrder, outItems, err := s.store.AcceptOrder(ctx, orderID, actor, items, s.now().UTC(), key)
	if err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, nil, ae
		}
		return nil, nil, apperr.Internal(err)
	}
	return outOrder, outItems, nil
}

type RepeatAvailabilityInput struct {
	OwnerUserID         uuid.UUID
	OrganizationID      uuid.UUID
	ServiceID           uuid.UUID
	SourceAppointmentID *uuid.UUID
}

type AnalyzeAvailabilityInput struct {
	OwnerUserID         uuid.UUID
	OrganizationID      uuid.UUID
	ServiceID           uuid.UUID
	AppointmentID       *uuid.UUID
	SourceAppointmentID *uuid.UUID
}

func (s *Service) RepeatAvailability(ctx context.Context, in RepeatAvailabilityInput) ([]domain.RequirementCheck, error) {
	out, err := s.AnalyzeAvailability(ctx, AnalyzeAvailabilityInput{
		OwnerUserID: in.OwnerUserID, OrganizationID: in.OrganizationID, ServiceID: in.ServiceID,
		SourceAppointmentID: in.SourceAppointmentID,
	})
	if err != nil {
		return nil, err
	}
	if out == nil {
		return []domain.RequirementCheck{}, nil
	}
	return out.Items, nil
}

func (s *Service) AnalyzeAvailability(ctx context.Context, in AnalyzeAvailabilityInput) (*domain.AvailabilityAnalysis, error) {
	if in.OwnerUserID == uuid.Nil || in.OrganizationID == uuid.Nil {
		return nil, apperr.Validation("owner_user_id and organization_id are required")
	}
	loc, err := s.EnsureMasterLocation(ctx, in.OwnerUserID, in.OrganizationID)
	if err != nil {
		return nil, err
	}
	result := &domain.AvailabilityAnalysis{
		ServiceID:     in.ServiceID,
		CanPerformNow: true,
		Status:        domain.AvailabilityAvailable,
		Items:         []domain.RequirementCheck{},
		Alternative:   domain.AvailabilityAlternative{Available: false},
	}
	if in.ServiceID == uuid.Nil {
		return result, nil
	}
	norms, err := s.store.ListNorms(ctx, in.OrganizationID, &in.ServiceID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	lines := make([]domain.QtyLine, 0, len(norms))
	for _, n := range norms {
		lines = append(lines, domain.QtyLine{ProductID: n.ProductID, Qty: n.Qty})
	}
	required := domain.AggregateRequirements(lines)
	if in.SourceAppointmentID != nil && *in.SourceAppointmentID != uuid.Nil {
		consumed, err := s.store.AppointmentConsumption(ctx, *in.SourceAppointmentID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		for pid, qty := range consumed {
			if _, ok := required[pid]; ok {
				required[pid] = qty
			}
		}
	}
	if in.AppointmentID != nil && *in.AppointmentID != uuid.Nil {
		consumed, err := s.store.AppointmentConsumption(ctx, *in.AppointmentID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		for pid := range required {
			required[pid] = domain.RemainingRequired(required[pid], consumed[pid])
			if required[pid] <= 1e-9 {
				delete(required, pid)
			}
		}
	}
	if len(required) == 0 {
		return result, nil
	}
	ids := make([]uuid.UUID, 0, len(required))
	for pid := range required {
		ids = append(ids, pid)
	}
	balances, err := s.store.ListBalancesByLocation(ctx, loc.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	onHand := map[uuid.UUID]domain.StockBalanceView{}
	availableByProduct := map[uuid.UUID]float64{}
	for _, b := range balances {
		onHand[b.ProductID] = b
		av := b.QtyOnHand - b.QtyReserved
		if av < 0 {
			av = 0
		}
		availableByProduct[b.ProductID] = av
	}
	incomingRows, err := s.store.IncomingRemainingByLocation(ctx, in.OrganizationID, loc.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	incomingQty := map[uuid.UUID]float64{}
	incomingAt := map[uuid.UUID]*time.Time{}
	for _, row := range incomingRows {
		incomingQty[row.ProductID] = row.Qty
		incomingAt[row.ProductID] = row.ExpectedAt
	}
	products, err := s.store.ListProductsByIDs(ctx, ids)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	byProduct := map[uuid.UUID]domain.Product{}
	for _, p := range products {
		byProduct[p.ID] = p
	}
	family, err := s.store.ListCatalogFamily(ctx, ids)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	out := make([]domain.RequirementCheck, 0, len(required))
	statuses := make([]string, 0, len(required))
	var alt *domain.FamilyAlternative
	for pid, qty := range required {
		bal := onHand[pid]
		p := byProduct[pid]
		name, brand, unit := p.Name, p.Brand, p.Unit
		if name == "" {
			name = bal.ProductName
			brand = bal.ProductBrand
			unit = bal.Unit
		}
		av, sh, st := domain.EvaluateRequirement(qty, bal.QtyOnHand, bal.QtyReserved, incomingQty[pid])
		st, orderable := domain.ApplyOrderability(st, domain.CatalogOrderable(p, in.OrganizationID))
		out = append(out, domain.RequirementCheck{
			ProductID: pid, Name: name, Brand: brand, Unit: unit,
			RequiredQty: qty, OnHand: bal.QtyOnHand, Reserved: bal.QtyReserved,
			AvailableQty: av, IncomingQty: incomingQty[pid], ShortageQty: sh,
			Status: st, Orderable: orderable, ExpectedAt: incomingAt[pid],
		})
		statuses = append(statuses, st)
		if alt == nil && (st == domain.AvailabilityShortage || st == domain.AvailabilityUnavailable || st == domain.AvailabilityOrderable) {
			need := qty - av
			if need < 1e-9 {
				need = qty
			}
			alt = domain.PickStoredFamilyAlternative(pid, need, family, availableByProduct)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].ProductID.String() < out[j].ProductID.String()
	})
	result.Items = out
	result.CanPerformNow = domain.CanRepeatFromStatuses(statuses)
	result.Status = domain.WorstAvailability(statuses)
	if alt != nil {
		result.Alternative = domain.AvailabilityAlternative{
			Available: true, ProductID: alt.ProductID, ProductName: alt.ProductName,
			Reason: "В каталоге есть вариант той же линейки на складе",
		}
	} else if !result.CanPerformNow {
		result.Alternative = domain.AvailabilityAlternative{Available: false, Reason: domain.NoStoredAlternativeReason}
	}
	return result, nil
}
