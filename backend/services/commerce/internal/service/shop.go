package service

import (
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

// --- shop catalog ---

func (s *Service) ListShopProducts(ctx context.Context, q, brand string, limit int) ([]domain.ShopProduct, error) {
	items, err := s.store.ListPublishedProducts(ctx, strings.TrimSpace(q), strings.TrimSpace(brand), limit)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.ShopProduct{}
	}
	return items, nil
}

func (s *Service) GetShopProduct(ctx context.Context, id uuid.UUID) (*domain.ShopProduct, error) {
	p, err := s.store.GetPublishedProduct(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if p == nil {
		return nil, apperr.NotFound("product not found")
	}
	return p, nil
}

func (s *Service) ListShopProductVariants(ctx context.Context, id uuid.UUID) ([]domain.ShopProduct, error) {
	items, err := s.store.ListPublishedVariants(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.ShopProduct{}
	}
	return items, nil
}

// --- cart ---

type CartResult struct {
	Cart  domain.ClientCart
	Items []domain.ClientCartItem
}

func (s *Service) GetCart(ctx context.Context, userID uuid.UUID, professional bool) (*CartResult, error) {
	now := s.now().UTC()
	cart, err := s.store.GetOrCreateCart(ctx, userID, now)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	items, err := s.store.ListCartItems(ctx, cart.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.ClientCartItem{}
	}
	filtered := make([]domain.ClientCartItem, 0, len(items))
	for _, it := range items {
		p, err := s.store.GetPublishedProduct(ctx, it.ProductID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if p == nil || !domain.ProductVisibleTo(p.Audience, professional) {
			_ = s.store.RemoveCartItem(ctx, cart.ID, it.ProductID, now)
			continue
		}
		filtered = append(filtered, it)
	}
	return &CartResult{Cart: *cart, Items: filtered}, nil
}

func (s *Service) SetCartItem(ctx context.Context, userID, productID uuid.UUID, qty float64, professional bool) (*CartResult, error) {
	now := s.now().UTC()
	cart, err := s.store.GetOrCreateCart(ctx, userID, now)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if qty <= 0 {
		if err := s.store.RemoveCartItem(ctx, cart.ID, productID, now); err != nil {
			return nil, apperr.Internal(err)
		}
		return s.GetCart(ctx, userID, professional)
	}
	p, err := s.store.GetPublishedProduct(ctx, productID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if p == nil {
		return nil, apperr.NotFound("product not found or not published")
	}
	if !domain.ProductVisibleTo(p.Audience, professional) {
		return nil, apperr.Forbidden("product not available")
	}
	if p.Available < qty-1e-9 {
		return nil, apperr.Validation("нет остатка")
	}
	if err := s.store.UpsertCartItem(ctx, cart.ID, productID, qty, p.PriceMinor, now); err != nil {
		return nil, apperr.Internal(err)
	}
	return s.GetCart(ctx, userID, professional)
}

func (s *Service) RemoveCartItem(ctx context.Context, userID, productID uuid.UUID, professional bool) (*CartResult, error) {
	now := s.now().UTC()
	cart, err := s.store.GetOrCreateCart(ctx, userID, now)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if err := s.store.RemoveCartItem(ctx, cart.ID, productID, now); err != nil {
		return nil, apperr.Internal(err)
	}
	return s.GetCart(ctx, userID, professional)
}

// --- checkout ---

type CheckoutInput struct {
	DeliveryAddress     string
	DeliveryComment     string
	PaymentMethod       string
	PickupBranchID      *uuid.UUID
	IdempotencyKey      string
	ConfirmPriceChanges bool
}

type CheckoutResult struct {
	GroupID    uuid.UUID
	TotalMinor int64
	Orders     []CheckoutOrderResult
}

type CheckoutOrderResult struct {
	Order domain.ClientOrder
	Items []domain.ClientOrderItem
}

func (s *Service) Checkout(ctx context.Context, userID uuid.UUID, professional bool, in CheckoutInput) (*CheckoutResult, error) {
	addr := strings.TrimSpace(in.DeliveryAddress)
	if addr == "" {
		return nil, apperr.Validation("delivery_address is required")
	}
	if in.PickupBranchID == nil || *in.PickupBranchID == uuid.Nil {
		return nil, apperr.Validation("pickup_branch_id is required")
	}
	if err := s.validateDestinationBranch(ctx, *in.PickupBranchID); err != nil {
		return nil, err
	}
	payment := normalizeClientPaymentMethod(in.PaymentMethod)
	if !domain.ValidPaymentMethod(payment) {
		return nil, apperr.Validation("invalid payment_method")
	}
	idemKey := strings.TrimSpace(in.IdempotencyKey)
	if idemKey != "" {
		if g, orders, err := s.store.GetCheckoutGroupByIdempotencyKey(ctx, userID, idemKey); err != nil {
			return nil, apperr.Internal(err)
		} else if g != nil {
			return s.checkoutResultFromGroup(ctx, *g, orders)
		}
		existing, err := s.store.GetClientOrderByIdempotencyKey(ctx, userID, idemKey)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if existing != nil {
			items, err := s.store.ListClientOrderItems(ctx, existing.ID)
			if err != nil {
				return nil, apperr.Internal(err)
			}
			return &CheckoutResult{
				TotalMinor: existing.TotalMinor,
				Orders:     []CheckoutOrderResult{{Order: *existing, Items: items}},
			}, nil
		}
	}
	now := s.now().UTC()
	cart, err := s.store.GetOrCreateCart(ctx, userID, now)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	items, err := s.store.ListCartItems(ctx, cart.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if len(items) == 0 {
		return nil, apperr.Validation("cart is empty")
	}
	supplierItems := map[uuid.UUID][]domain.ClientCartItem{}
	for _, it := range items {
		p, err := s.store.GetPublishedProduct(ctx, it.ProductID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if p == nil {
			return nil, apperr.Validation("товар больше недоступен: " + it.Name)
		}
		if !domain.ProductVisibleTo(p.Audience, professional) {
			return nil, apperr.Forbidden("товар недоступен для покупки: " + it.Name)
		}
		if p.Available < it.Qty-1e-9 {
			return nil, apperr.Validation("нет остатка для " + it.Name)
		}
		if it.CartPriceMinor != p.PriceMinor && !in.ConfirmPriceChanges {
			return nil, apperr.Conflict("цена изменилась: " + it.Name + ". Обновите корзину и подтвердите оформление.")
		}
		supplierItems[it.OrganizationID] = append(supplierItems[it.OrganizationID], it)
	}
	groupID := ids.New()
	var groupTotal int64
	batches := make([]store.CheckoutBatchOrder, 0, len(supplierItems))
	for supplierOrg, its := range supplierItems {
		var totalMinor int64
		orderItems := make([]domain.ClientOrderItem, 0, len(its))
		for _, it := range its {
			p, _ := s.store.GetPublishedProduct(ctx, it.ProductID)
			price := p.PriceMinor
			totalMinor += int64(it.Qty*float64(price) + 0.5)
			orderItems = append(orderItems, domain.ClientOrderItem{
				ID: ids.New(), ProductID: it.ProductID, ProductName: p.Name, Brand: p.Brand,
				Qty: it.Qty, PriceMinor: price,
			})
		}
		groupTotal += totalMinor
		orderID := ids.New()
		order := domain.ClientOrder{
			ID: orderID, UserID: userID, SupplierOrgID: supplierOrg,
			Status: domain.ClientOrderStatusSubmitted, Currency: "RUB", TotalMinor: totalMinor,
			DeliveryAddress: addr, DeliveryComment: strings.TrimSpace(in.DeliveryComment),
			PaymentMethod: payment, PickupBranchID: in.PickupBranchID,
			CheckoutGroupID: &groupID, CreatedAt: now, UpdatedAt: now,
		}
		payStatus, err := resolveClientPaymentStatus(payment, clientPaymentProvider(payment), ctx, order)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		order.PaymentStatus = payStatus
		batches = append(batches, store.CheckoutBatchOrder{
			Order: order, Items: orderItems,
			History: domain.ClientOrderStatusHistory{
				ID: ids.New(), OrderID: orderID, FromStatus: "", ToStatus: domain.ClientOrderStatusSubmitted,
				ActorUserID: userID, CreatedAt: now,
			},
		})
	}
	group := domain.ClientCheckoutGroup{
		ID: groupID, UserID: userID, IdempotencyKey: idemKey, TotalMinor: groupTotal, CreatedAt: now,
	}
	_, outOrders, err := s.store.CreateCheckoutBatch(ctx, group, batches, cart.ID, userID)
	if err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	result, err := s.checkoutResultFromGroup(ctx, group, outOrders)
	if err != nil {
		return nil, err
	}
	for _, o := range result.Orders {
		num := domain.FormatClientOrderNumber(o.Order.ID, o.Order.CreatedAt)
		s.notifyClientOrder(ctx, userID, "client_order.created", "Заказ оформлен", "Ваш заказ "+num+" принят в обработку", o.Order.ID)
	}
	return result, nil
}

func (s *Service) checkoutResultFromGroup(ctx context.Context, g domain.ClientCheckoutGroup, orders []domain.ClientOrder) (*CheckoutResult, error) {
	out := make([]CheckoutOrderResult, 0, len(orders))
	for _, o := range orders {
		items, err := s.store.ListClientOrderItems(ctx, o.ID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		out = append(out, CheckoutOrderResult{Order: o, Items: items})
	}
	return &CheckoutResult{GroupID: g.ID, TotalMinor: g.TotalMinor, Orders: out}, nil
}

// --- client orders ---

func (s *Service) ListMyClientOrders(ctx context.Context, userID uuid.UUID) ([]domain.ClientOrder, error) {
	items, err := s.store.ListClientOrdersByUser(ctx, userID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.ClientOrder{}
	}
	return items, nil
}

func (s *Service) GetMyClientOrder(ctx context.Context, userID, orderID uuid.UUID) (*domain.ClientOrder, []domain.ClientOrderItem, []domain.ClientOrderStatusHistory, error) {
	o, err := s.store.GetClientOrder(ctx, orderID)
	if err != nil {
		return nil, nil, nil, apperr.Internal(err)
	}
	if o == nil {
		return nil, nil, nil, apperr.NotFound("order not found")
	}
	if o.UserID != userID {
		return nil, nil, nil, apperr.Forbidden("not your order")
	}
	items, err := s.store.ListClientOrderItems(ctx, orderID)
	if err != nil {
		return nil, nil, nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.ClientOrderItem{}
	}
	history, err := s.store.ListClientOrderStatusHistory(ctx, orderID)
	if err != nil {
		return nil, nil, nil, apperr.Internal(err)
	}
	if history == nil {
		history = []domain.ClientOrderStatusHistory{}
	}
	return o, items, history, nil
}

func (s *Service) ClientOrderItems(ctx context.Context, orderID uuid.UUID) ([]domain.ClientOrderItem, error) {
	items, err := s.store.ListClientOrderItems(ctx, orderID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.ClientOrderItem{}
	}
	return items, nil
}

type ReorderResult struct {
	Cart    CartResult
	Skipped []SkippedProduct
}

type SkippedProduct struct {
	ProductID uuid.UUID
	Name      string
	Reason    string
}

func (s *Service) Reorder(ctx context.Context, userID, orderID uuid.UUID, professional bool) (*ReorderResult, error) {
	o, items, _, err := s.GetMyClientOrder(ctx, userID, orderID)
	if err != nil {
		return nil, err
	}
	_ = o
	now := s.now().UTC()
	cart, err := s.store.GetOrCreateCart(ctx, userID, now)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if err := s.store.ClearCart(ctx, cart.ID, now); err != nil {
		return nil, apperr.Internal(err)
	}
	var skipped []SkippedProduct
	for _, it := range items {
		p, err := s.store.GetPublishedProduct(ctx, it.ProductID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if p == nil {
			skipped = append(skipped, SkippedProduct{ProductID: it.ProductID, Name: it.ProductName, Reason: "not published"})
			continue
		}
		if !domain.ProductVisibleTo(p.Audience, professional) {
			skipped = append(skipped, SkippedProduct{ProductID: it.ProductID, Name: it.ProductName, Reason: "not available"})
			continue
		}
		if p.Available < it.Qty-1e-9 {
			skipped = append(skipped, SkippedProduct{ProductID: it.ProductID, Name: it.ProductName, Reason: "нет остатка"})
			continue
		}
		if err := s.store.UpsertCartItem(ctx, cart.ID, it.ProductID, it.Qty, p.PriceMinor, now); err != nil {
			return nil, apperr.Internal(err)
		}
	}
	cartRes, err := s.GetCart(ctx, userID, professional)
	if err != nil {
		return nil, err
	}
	if skipped == nil {
		skipped = []SkippedProduct{}
	}
	return &ReorderResult{Cart: *cartRes, Skipped: skipped}, nil
}

// --- supplier client orders ---

func (s *Service) ListSupplierClientOrders(ctx context.Context, actor, orgID uuid.UUID, status string) ([]domain.ClientOrder, error) {
	if err := s.requireMembership(ctx, orgID, actor, "owner", "admin", "master"); err != nil {
		return nil, err
	}
	items, err := s.store.ListClientOrdersBySupplier(ctx, orgID, strings.TrimSpace(status))
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.ClientOrder{}
	}
	return items, nil
}

var clientOrderTransitions = map[string]map[string]bool{
	domain.ClientOrderStatusSubmitted:  {domain.ClientOrderStatusConfirmed: true, domain.ClientOrderStatusCancelled: true},
	domain.ClientOrderStatusConfirmed:  {domain.ClientOrderStatusPicking: true, domain.ClientOrderStatusCancelled: true},
	domain.ClientOrderStatusPicking:    {domain.ClientOrderStatusInDelivery: true},
	domain.ClientOrderStatusInDelivery: {domain.ClientOrderStatusDelivered: true},
}

type TransitionClientOrderInput struct {
	Status    string
	RepUserID *uuid.UUID
}

func (s *Service) TransitionClientOrder(ctx context.Context, actor, orderID uuid.UUID, in TransitionClientOrderInput) (*domain.ClientOrder, []domain.ClientOrderItem, error) {
	toStatus := strings.TrimSpace(in.Status)
	o, err := s.store.GetClientOrder(ctx, orderID)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if o == nil {
		return nil, nil, apperr.NotFound("order not found")
	}
	if err := s.requireMembership(ctx, o.SupplierOrgID, actor, "owner", "admin", "master"); err != nil {
		return nil, nil, err
	}
	allowed, ok := clientOrderTransitions[o.Status]
	if !ok || !allowed[toStatus] {
		return nil, nil, apperr.Conflict("invalid status transition from " + o.Status + " to " + toStatus)
	}
	now := s.now().UTC()

	if toStatus == domain.ClientOrderStatusDelivered {
		items, err := s.store.ListClientOrderItems(ctx, orderID)
		if err != nil {
			return nil, nil, apperr.Internal(err)
		}
		delivered := make([]store.DeliveredItemQty, 0, len(items))
		for _, it := range items {
			delivered = append(delivered, store.DeliveredItemQty{ProductID: it.ProductID, QtyDelivered: it.Qty})
		}
		history := domain.ClientOrderStatusHistory{
			ID: ids.New(), OrderID: orderID, FromStatus: o.Status, ToStatus: toStatus,
			ActorUserID: actor, CreatedAt: now,
		}
		outOrder, outItems, err := s.store.MarkDelivered(ctx, store.MarkDeliveredParams{
			OrderID: orderID, Items: delivered, ActorUserID: actor, History: history, Now: now,
		})
		if err != nil {
			if ae, ok := apperr.As(err); ok {
				return nil, nil, ae
			}
			return nil, nil, apperr.Internal(err)
		}
		return outOrder, outItems, nil
	}

	var repID *uuid.UUID
	if toStatus == domain.ClientOrderStatusInDelivery && in.RepUserID != nil && *in.RepUserID != uuid.Nil {
		repID = in.RepUserID
	}
	history := domain.ClientOrderStatusHistory{
		ID: ids.New(), OrderID: orderID, FromStatus: o.Status, ToStatus: toStatus,
		ActorUserID: actor, CreatedAt: now,
	}
	outOrder, err := s.store.TransitionClientOrder(ctx, store.TransitionClientOrderParams{
		OrderID: orderID, ToStatus: toStatus, RepUserID: repID, ActorUserID: actor, History: history, Now: now,
	})
	if err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, nil, ae
		}
		return nil, nil, apperr.Internal(err)
	}
	items, err := s.store.ListClientOrderItems(ctx, orderID)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	return outOrder, items, nil
}

// --- rep deliveries ---

func (s *Service) ListRepDeliveries(ctx context.Context, actor, orgID uuid.UUID) ([]domain.ClientOrder, error) {
	statuses := []string{domain.ClientOrderStatusInDelivery, domain.ClientOrderStatusDelivered}
	isOwnerAdmin := s.requireMembership(ctx, orgID, actor, "owner", "admin") == nil
	isRep := s.requireMembership(ctx, orgID, actor, "rep") == nil
	if !isOwnerAdmin && !isRep {
		return nil, apperr.Forbidden("not authorized for rep deliveries")
	}
	var repFilter *uuid.UUID
	if !isOwnerAdmin {
		repFilter = &actor
	} else {
		// owner/admin sees all in_delivery for org (plus their delivered if assigned - spec says in_delivery for org listing)
		statuses = []string{domain.ClientOrderStatusInDelivery}
	}
	items, err := s.store.ListRepDeliveries(ctx, orgID, repFilter, statuses)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.ClientOrder{}
	}
	return items, nil
}

type CompleteDeliveryInput struct {
	Items                []DeliveredItemInput
	Note                 string
	AmountCollectedMinor int64
	PaymentReceived      bool
}

type DeliveredItemInput struct {
	ProductID    uuid.UUID
	QtyDelivered float64
}

func (s *Service) CompleteRepDelivery(ctx context.Context, actor, orderID uuid.UUID, in CompleteDeliveryInput) (*domain.ClientOrder, []domain.ClientOrderItem, error) {
	o, err := s.store.GetClientOrder(ctx, orderID)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if o == nil {
		return nil, nil, apperr.NotFound("order not found")
	}
	if o.Status != domain.ClientOrderStatusInDelivery {
		return nil, nil, apperr.Conflict("order is not in delivery")
	}
	isOwnerAdmin := s.requireMembership(ctx, o.SupplierOrgID, actor, "owner", "admin") == nil
	isAssignedRep := o.RepUserID != nil && *o.RepUserID == actor
	isRepMember := s.requireMembership(ctx, o.SupplierOrgID, actor, "rep") == nil
	if !isOwnerAdmin && !(isAssignedRep && isRepMember) {
		return nil, nil, apperr.Forbidden("not authorized to complete this delivery")
	}
	if len(in.Items) == 0 {
		return nil, nil, apperr.Validation("at least one item is required")
	}
	delivered := make([]store.DeliveredItemQty, 0, len(in.Items))
	for _, it := range in.Items {
		if it.ProductID == uuid.Nil {
			return nil, nil, apperr.Validation("product_id is required")
		}
		if it.QtyDelivered < 0 {
			return nil, nil, apperr.Validation("qty_delivered must not be negative")
		}
		delivered = append(delivered, store.DeliveredItemQty{ProductID: it.ProductID, QtyDelivered: it.QtyDelivered})
	}
	now := s.now().UTC()
	history := domain.ClientOrderStatusHistory{
		ID: ids.New(), OrderID: orderID, FromStatus: o.Status, ToStatus: domain.ClientOrderStatusDelivered,
		ActorUserID: actor, Note: strings.TrimSpace(in.Note), CreatedAt: now,
	}
	var debtPayment *domain.DebtEntry
	if in.PaymentReceived && in.AmountCollectedMinor > 0 {
		amt := -in.AmountCollectedMinor
		debtPayment = &domain.DebtEntry{
			ID: ids.New(), SupplierOrgID: o.SupplierOrgID, ClientUserID: o.UserID,
			Kind: domain.DebtKindPayment, AmountMinor: amt,
			RefType: "client_order", RefID: &o.ID, Note: "payment on delivery",
			ActorUserID: actor, CreatedAt: now,
		}
	}
	outOrder, outItems, err := s.store.MarkDelivered(ctx, store.MarkDeliveredParams{
		OrderID: orderID, Items: delivered, DeliveryNote: strings.TrimSpace(in.Note),
		AmountCollectedMinor: in.AmountCollectedMinor, ActorUserID: actor,
		History: history, DebtPayment: debtPayment, Now: now,
	})
	if err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, nil, ae
		}
		return nil, nil, apperr.Internal(err)
	}
	num := domain.FormatClientOrderNumber(outOrder.ID, outOrder.CreatedAt)
	s.notifyClientOrder(ctx, outOrder.UserID, "client_order.delivered_to_salon", "Заказ в салоне",
		"Заказ "+num+" доставлен в пункт выдачи", outOrder.ID)
	return outOrder, outItems, nil
}

func (s *Service) GetDebtBalance(ctx context.Context, actor, orgID, clientUserID uuid.UUID) (int64, error) {
	isStaff := s.requireMembership(ctx, orgID, actor, "owner", "admin", "master", "rep") == nil
	if !isStaff {
		if actor != clientUserID {
			return 0, apperr.Forbidden("client_user_id must match actor")
		}
	}
	total, err := s.store.SumDebt(ctx, orgID, clientUserID)
	if err != nil {
		return 0, apperr.Internal(err)
	}
	return total, nil
}

// --- CSV import ---

const productImportTemplate = "sku,brand,name,unit,price_rubles,min_stock,qty_on_hand\n"

func (s *Service) ProductImportTemplate() string { return productImportTemplate }

type ImportRow struct {
	SKU         string
	Brand       string
	Name        string
	Unit        string
	PriceRubles string
	MinStock    string
	QtyOnHand   string
}

type ImportValidationReport struct {
	Errors   []string         `json:"errors"`
	Preview  []map[string]any `json:"preview"`
	RowCount int              `json:"row_count"`
}

func parseProductCSV(body []byte) ([]ImportRow, []string) {
	r := csv.NewReader(strings.NewReader(string(body)))
	r.TrimLeadingSpace = true
	r.FieldsPerRecord = -1
	records, err := r.ReadAll()
	if err != nil {
		return nil, []string{"invalid csv: " + err.Error()}
	}
	if len(records) == 0 {
		return nil, []string{"csv is empty"}
	}
	header := records[0]
	colIdx := map[string]int{}
	for i, h := range header {
		colIdx[strings.ToLower(strings.TrimSpace(h))] = i
	}
	required := []string{"sku", "brand", "name", "unit", "price_rubles", "min_stock"}
	for _, req := range required {
		if _, ok := colIdx[req]; !ok {
			return nil, []string{"missing required column: " + req}
		}
	}
	var rows []ImportRow
	var errs []string
	for i, rec := range records[1:] {
		if len(rec) == 0 || (len(rec) == 1 && strings.TrimSpace(rec[0]) == "") {
			continue
		}
		get := func(name string) string {
			idx, ok := colIdx[name]
			if !ok || idx >= len(rec) {
				return ""
			}
			return strings.TrimSpace(rec[idx])
		}
		row := ImportRow{
			SKU: get("sku"), Brand: get("brand"), Name: get("name"), Unit: get("unit"),
			PriceRubles: get("price_rubles"), MinStock: get("min_stock"), QtyOnHand: get("qty_on_hand"),
		}
		if row.SKU == "" {
			errs = append(errs, fmt.Sprintf("row %d: sku is required", i+2))
		}
		if row.Name == "" {
			errs = append(errs, fmt.Sprintf("row %d: name is required", i+2))
		}
		rows = append(rows, row)
	}
	return rows, errs
}

func (s *Service) ValidateProductImport(ctx context.Context, actor, orgID uuid.UUID, body []byte) (*domain.ImportJob, *ImportValidationReport, error) {
	return s.validateProductImportCore(ctx, actor, orgID, body)
}

type ApplyImportInput struct {
	LocationID *uuid.UUID
}

func (s *Service) ApplyProductImport(ctx context.Context, actor, jobID uuid.UUID, in ApplyImportInput) (*domain.ImportJob, error) {
	job, err := s.store.GetImportJob(ctx, jobID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if job == nil {
		return nil, apperr.NotFound("import job not found")
	}
	if err := s.requireMembership(ctx, job.OrganizationID, actor, "owner", "admin", "master"); err != nil {
		return nil, err
	}
	if job.Status == domain.ImportJobStatusApplied {
		return nil, apperr.Conflict("import already applied")
	}
	var report ImportValidationReport
	if err := json.Unmarshal(job.Report, &report); err != nil {
		return nil, apperr.Internal(err)
	}
	if len(report.Errors) > 0 {
		return nil, apperr.Validation("import has validation errors")
	}
	// Re-parse from stored preview is insufficient; re-validate requires original body.
	// Store full rows in report during validate for apply.
	type storedReport struct {
		Errors   []string         `json:"errors"`
		Preview  []map[string]any `json:"preview"`
		RowCount int              `json:"row_count"`
		Rows     []ImportRow      `json:"rows,omitempty"`
	}
	var full storedReport
	_ = json.Unmarshal(job.Report, &full)

	now := s.now().UTC()
	applied := 0
	var applyErrs []string
	rows := full.Rows
	if len(rows) == 0 {
		// fallback: use preview rows only (limited)
		for _, p := range report.Preview {
			rows = append(rows, ImportRow{
				SKU: fmt.Sprint(p["sku"]), Brand: fmt.Sprint(p["brand"]), Name: fmt.Sprint(p["name"]),
				Unit: fmt.Sprint(p["unit"]), PriceRubles: fmt.Sprint(p["price_rubles"]),
				MinStock: fmt.Sprint(p["min_stock"]), QtyOnHand: fmt.Sprint(p["qty_on_hand"]),
			})
		}
	}
	for i, row := range rows {
		priceRub, err := strconv.ParseFloat(row.PriceRubles, 64)
		if err != nil {
			applyErrs = append(applyErrs, fmt.Sprintf("row %d: invalid price", i+1))
			continue
		}
		minStock, _ := strconv.ParseFloat(row.MinStock, 64)
		priceMinor := int64(priceRub*100 + 0.5)
		unit := strings.TrimSpace(row.Unit)
		if unit == "" {
			unit = "pcs"
		}
		existing, err := s.store.GetProductByOrgSKU(ctx, job.OrganizationID, row.SKU)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		var productID uuid.UUID
		if existing != nil {
			existing.Brand = row.Brand
			existing.Name = row.Name
			existing.Unit = unit
			existing.PriceMinor = priceMinor
			existing.MinStock = minStock
			existing.UpdatedAt = now
			if err := s.store.UpdateProduct(ctx, *existing); err != nil {
				if ae, ok := apperr.As(err); ok {
					applyErrs = append(applyErrs, ae.Message)
					continue
				}
				return nil, apperr.Internal(err)
			}
			productID = existing.ID
		} else {
			p := domain.Product{
				ID: ids.New(), OrganizationID: job.OrganizationID, Brand: row.Brand, Name: row.Name,
				SKU: row.SKU, Unit: unit, PriceMinor: priceMinor, Currency: "RUB", MinStock: minStock,
				CreatedAt: now, UpdatedAt: now,
			}
			if err := s.store.CreateProduct(ctx, p); err != nil {
				if ae, ok := apperr.As(err); ok {
					applyErrs = append(applyErrs, ae.Message)
					continue
				}
				return nil, apperr.Internal(err)
			}
			productID = p.ID
		}
		if row.QtyOnHand != "" && in.LocationID != nil {
			qty, err := strconv.ParseFloat(row.QtyOnHand, 64)
			if err == nil && qty > 0 {
				loc, err := s.getLocationOrErr(ctx, *in.LocationID)
				if err != nil {
					return nil, err
				}
				if loc.OrganizationID != job.OrganizationID {
					return nil, apperr.Validation("location does not belong to organization")
				}
				mv := domain.StockMovement{
					ID: ids.New(), LocationID: *in.LocationID, ProductID: productID,
					Kind: domain.MovementReceipt, Qty: qty, Reason: "csv import",
					ActorUserID: actor, RefType: "import_job", RefID: &job.ID, CreatedAt: now,
				}
				if _, err := s.store.CreateMovement(ctx, mv); err != nil {
					if ae, ok := apperr.As(err); ok {
						applyErrs = append(applyErrs, ae.Message)
						continue
					}
					return nil, apperr.Internal(err)
				}
			}
		}
		applied++
	}
	finalReport := map[string]any{"applied": applied, "errors": applyErrs, "row_count": len(rows)}
	if applyErrs == nil {
		finalReport["errors"] = []string{}
	}
	reportJSON, _ := json.Marshal(finalReport)
	status := domain.ImportJobStatusApplied
	if len(applyErrs) > 0 && applied == 0 {
		status = domain.ImportJobStatusFailed
	}
	if err := s.store.UpdateImportJob(ctx, jobID, status, reportJSON); err != nil {
		return nil, apperr.Internal(err)
	}
	job.Status = status
	job.Report = reportJSON
	return job, nil
}

func (s *Service) validateProductImportCore(ctx context.Context, actor, orgID uuid.UUID, body []byte) (*domain.ImportJob, *ImportValidationReport, error) {
	if err := s.requireMembership(ctx, orgID, actor, "owner", "admin", "master"); err != nil {
		return nil, nil, err
	}
	sum := sha256.Sum256(body)
	checksum := hex.EncodeToString(sum[:])
	existing, err := s.store.GetImportJobByChecksum(ctx, orgID, domain.ImportJobKindProducts, checksum)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if existing != nil && existing.Status == domain.ImportJobStatusApplied {
		return nil, nil, apperr.Conflict("duplicate import already applied")
	}
	if existing != nil && existing.Status == domain.ImportJobStatusValidated {
		var report ImportValidationReport
		_ = json.Unmarshal(existing.Report, &report)
		if report.Preview == nil {
			report.Preview = []map[string]any{}
		}
		if report.Errors == nil {
			report.Errors = []string{}
		}
		return existing, &report, nil
	}
	rows, parseErrs := parseProductCSV(body)
	type storedReport struct {
		Errors   []string         `json:"errors"`
		Preview  []map[string]any `json:"preview"`
		RowCount int              `json:"row_count"`
		Rows     []ImportRow      `json:"rows"`
	}
	stored := storedReport{RowCount: len(rows), Rows: rows, Errors: parseErrs}
	preview := make([]map[string]any, 0, min(len(rows), 10))
	for i, row := range rows {
		if _, err := strconv.ParseFloat(row.PriceRubles, 64); row.PriceRubles != "" && err != nil {
			stored.Errors = append(stored.Errors, fmt.Sprintf("row %d: invalid price_rubles", i+2))
		}
		if row.MinStock != "" {
			if _, err := strconv.ParseFloat(row.MinStock, 64); err != nil {
				stored.Errors = append(stored.Errors, fmt.Sprintf("row %d: invalid min_stock", i+2))
			}
		}
		if row.QtyOnHand != "" {
			if _, err := strconv.ParseFloat(row.QtyOnHand, 64); err != nil {
				stored.Errors = append(stored.Errors, fmt.Sprintf("row %d: invalid qty_on_hand", i+2))
			}
		}
		if i < 10 {
			preview = append(preview, map[string]any{
				"sku": row.SKU, "brand": row.Brand, "name": row.Name, "unit": row.Unit,
				"price_rubles": row.PriceRubles, "min_stock": row.MinStock, "qty_on_hand": row.QtyOnHand,
			})
		}
	}
	stored.Preview = preview
	if stored.Preview == nil {
		stored.Preview = []map[string]any{}
	}
	if stored.Errors == nil {
		stored.Errors = []string{}
	}
	report := &ImportValidationReport{Errors: stored.Errors, Preview: stored.Preview, RowCount: stored.RowCount}
	reportJSON, _ := json.Marshal(stored)
	now := s.now().UTC()
	job := domain.ImportJob{
		ID: ids.New(), OrganizationID: orgID, Kind: domain.ImportJobKindProducts,
		Checksum: checksum, Status: domain.ImportJobStatusValidated, Report: reportJSON,
		CreatedBy: actor, CreatedAt: now,
	}
	if err := s.store.InsertImportJob(ctx, job); err != nil {
		return nil, nil, apperr.Internal(err)
	}
	return &job, report, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ReadImportBody reads all bytes from r up to 5MB.
func ReadImportBody(r io.Reader) ([]byte, error) {
	return io.ReadAll(io.LimitReader(r, 5<<20))
}
