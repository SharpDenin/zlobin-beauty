package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerShopRoutes(mux *http.ServeMux, auth func(http.Handler) http.Handler) {
	mux.Handle("GET /v1/commerce/shop/products", auth(http.HandlerFunc(a.listShopProducts)))
	mux.Handle("GET /v1/commerce/shop/products/{id}", auth(http.HandlerFunc(a.getShopProduct)))
	mux.Handle("GET /v1/commerce/shop/cart", auth(http.HandlerFunc(a.getCart)))
	mux.Handle("PUT /v1/commerce/shop/cart/items", auth(http.HandlerFunc(a.setCartItem)))
	mux.Handle("DELETE /v1/commerce/shop/cart/items/{product_id}", auth(http.HandlerFunc(a.removeCartItem)))
	mux.Handle("POST /v1/commerce/shop/checkout", auth(http.HandlerFunc(a.checkout)))
	mux.Handle("GET /v1/commerce/shop/orders", auth(http.HandlerFunc(a.listMyClientOrders)))
	mux.Handle("GET /v1/commerce/shop/orders/{id}", auth(http.HandlerFunc(a.getMyClientOrder)))
	mux.Handle("POST /v1/commerce/shop/orders/{id}/reorder", auth(http.HandlerFunc(a.reorder)))
	mux.Handle("GET /v1/commerce/shop/pickup/orders", auth(http.HandlerFunc(a.listSalonPickupOrders)))
	mux.Handle("POST /v1/commerce/shop/pickup/orders/{id}/accept", auth(http.HandlerFunc(a.acceptSalonPickupOrder)))
	mux.Handle("POST /v1/commerce/shop/pickup/orders/{id}/handover", auth(http.HandlerFunc(a.handoverSalonPickupOrder)))
	mux.Handle("GET /v1/commerce/shop/supplier/orders", auth(http.HandlerFunc(a.listSupplierClientOrders)))
	mux.Handle("POST /v1/commerce/shop/supplier/orders/{id}/transition", auth(http.HandlerFunc(a.transitionClientOrder)))
	mux.Handle("GET /v1/commerce/rep/deliveries", auth(http.HandlerFunc(a.listRepDeliveries)))
	mux.Handle("POST /v1/commerce/rep/deliveries/{id}/complete", auth(http.HandlerFunc(a.completeRepDelivery)))
	mux.Handle("GET /v1/commerce/rep/analytics", auth(http.HandlerFunc(a.repAnalytics)))
	mux.Handle("GET /v1/commerce/shop/debt", auth(http.HandlerFunc(a.getDebtBalance)))
	mux.Handle("POST /v1/commerce/imports/products/validate", auth(http.HandlerFunc(a.validateProductImport)))
	mux.Handle("POST /v1/commerce/imports/{id}/apply", auth(http.HandlerFunc(a.applyProductImport)))
	mux.Handle("GET /v1/commerce/imports/products/template", auth(http.HandlerFunc(a.productImportTemplate)))
}

func (a *API) listShopProducts(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var roles []string
	if claims != nil {
		roles = claims.Roles
	}
	professional := hasProfessionalRole(roles)
	q := r.URL.Query().Get("q")
	brand := r.URL.Query().Get("brand")
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	items, err := a.svc.ListShopProducts(r.Context(), q, brand, limit)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, p := range items {
		if !domain.ProductVisibleTo(p.Audience, professional) {
			continue
		}
		out = append(out, shopProductDTO(p))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) getShopProduct(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var roles []string
	if claims != nil {
		roles = claims.Roles
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	p, err := a.svc.GetShopProduct(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	if !domain.ProductVisibleTo(p.Audience, hasProfessionalRole(roles)) {
		httpx.WriteError(w, r, a.log, apperr.NotFound("product not found"))
		return
	}
	variants, err := a.svc.ListShopProductVariants(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	dto := shopProductDTO(*p)
	vOut := make([]map[string]any, 0, len(variants))
	for _, v := range variants {
		vOut = append(vOut, shopProductDTO(v))
	}
	dto["variants"] = vOut
	httpx.JSON(w, http.StatusOK, dto)
}

func shopProductDTO(p domain.ShopProduct) map[string]any {
	dto := productDTO(p.Product)
	dto["available"] = p.Available
	return dto
}

func hasProfessionalRole(roles []string) bool {
	for _, role := range roles {
		switch role {
		case "master", "supplier", "supplier_rep", "salon_owner", "salon_admin", "system_admin":
			return true
		}
	}
	return false
}

func (a *API) getCart(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var roles []string
	if claims != nil {
		roles = claims.Roles
	}
	cart, err := a.svc.GetCart(r.Context(), claims.UserID, hasProfessionalRole(roles))
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, cartDTO(*cart))
}

func (a *API) setCartItem(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var roles []string
	if claims != nil {
		roles = claims.Roles
	}
	var req struct {
		ProductID string  `json:"product_id"`
		Qty       float64 `json:"qty"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	productID, err := uuid.Parse(req.ProductID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid product_id"))
		return
	}
	cart, err := a.svc.SetCartItem(r.Context(), claims.UserID, productID, req.Qty, hasProfessionalRole(roles))
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, cartDTO(*cart))
}

func (a *API) removeCartItem(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var roles []string
	if claims != nil {
		roles = claims.Roles
	}
	productID, err := uuid.Parse(r.PathValue("product_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid product_id"))
		return
	}
	cart, err := a.svc.RemoveCartItem(r.Context(), claims.UserID, productID, hasProfessionalRole(roles))
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, cartDTO(*cart))
}

func (a *API) checkout(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var roles []string
	if claims != nil {
		roles = claims.Roles
	}
	var req struct {
		DeliveryAddress     string `json:"delivery_address"`
		DeliveryComment     string `json:"delivery_comment"`
		PaymentMethod       string `json:"payment_method"`
		PickupBranchID      string `json:"pickup_branch_id"`
		IdempotencyKey      string `json:"idempotency_key"`
		ConfirmPriceChanges bool   `json:"confirm_price_changes"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	in := service.CheckoutInput{
		DeliveryAddress: req.DeliveryAddress, DeliveryComment: req.DeliveryComment, PaymentMethod: req.PaymentMethod,
		IdempotencyKey: req.IdempotencyKey, ConfirmPriceChanges: req.ConfirmPriceChanges,
	}
	if in.IdempotencyKey == "" {
		in.IdempotencyKey = strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	}
	if strings.TrimSpace(req.PickupBranchID) != "" {
		id, err := uuid.Parse(req.PickupBranchID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid pickup_branch_id"))
			return
		}
		in.PickupBranchID = &id
	}
	result, err := a.svc.Checkout(r.Context(), claims.UserID, hasProfessionalRole(roles), in)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, checkoutResultDTO(*result))
}

func (a *API) listMyClientOrders(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orders, err := a.svc.ListMyClientOrders(r.Context(), claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(orders))
	for _, o := range orders {
		items, err := a.svc.ClientOrderItems(r.Context(), o.ID)
		if err != nil {
			httpx.WriteError(w, r, a.log, err)
			return
		}
		out = append(out, clientOrderDTO(o, items, nil))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) getMyClientOrder(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	order, items, history, err := a.svc.GetMyClientOrder(r.Context(), claims.UserID, id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, clientOrderDTO(*order, items, history))
}

func (a *API) reorder(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var roles []string
	if claims != nil {
		roles = claims.Roles
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	res, err := a.svc.Reorder(r.Context(), claims.UserID, id, hasProfessionalRole(roles))
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	skipped := make([]map[string]any, 0, len(res.Skipped))
	for _, s := range res.Skipped {
		skipped = append(skipped, map[string]any{
			"product_id": s.ProductID.String(), "name": s.Name, "reason": s.Reason,
		})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"cart": cartDTO(res.Cart), "skipped": skipped})
}

func (a *API) listSupplierClientOrders(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.URL.Query().Get("organization_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("organization_id is required"))
		return
	}
	status := r.URL.Query().Get("status")
	orders, err := a.svc.ListSupplierClientOrders(r.Context(), claims.UserID, orgID, status)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(orders))
	for _, o := range orders {
		items, err := a.svc.ClientOrderItems(r.Context(), o.ID)
		if err != nil {
			httpx.WriteError(w, r, a.log, err)
			return
		}
		out = append(out, clientOrderDTO(o, items, nil))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) transitionClientOrder(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Status    string  `json:"status"`
		RepUserID *string `json:"rep_user_id"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	var repID *uuid.UUID
	if req.RepUserID != nil && *req.RepUserID != "" {
		id, err := uuid.Parse(*req.RepUserID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid rep_user_id"))
			return
		}
		repID = &id
	}
	order, items, err := a.svc.TransitionClientOrder(r.Context(), claims.UserID, id, service.TransitionClientOrderInput{
		Status: req.Status, RepUserID: repID,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, clientOrderDTO(*order, items, nil))
}

func (a *API) listRepDeliveries(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.URL.Query().Get("organization_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("organization_id is required"))
		return
	}
	orders, err := a.svc.ListRepDeliveries(r.Context(), claims.UserID, orgID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(orders))
	for _, o := range orders {
		items, err := a.svc.ClientOrderItems(r.Context(), o.ID)
		if err != nil {
			httpx.WriteError(w, r, a.log, err)
			return
		}
		out = append(out, clientOrderDTO(o, items, nil))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) repAnalytics(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.URL.Query().Get("organization_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("organization_id is required"))
		return
	}
	from, to := parseAnalyticsRange(r)
	body, err := a.svc.RepAnalytics(r.Context(), claims.UserID, orgID, from, to)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, body)
}

func (a *API) completeRepDelivery(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Items []struct {
			ProductID    string  `json:"product_id"`
			QtyDelivered float64 `json:"qty_delivered"`
		} `json:"items"`
		Note                 string `json:"note"`
		AmountCollectedMinor int64  `json:"amount_collected_minor"`
		PaymentReceived      bool   `json:"payment_received"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	items := make([]service.DeliveredItemInput, 0, len(req.Items))
	for _, it := range req.Items {
		productID, err := uuid.Parse(it.ProductID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid product_id"))
			return
		}
		items = append(items, service.DeliveredItemInput{ProductID: productID, QtyDelivered: it.QtyDelivered})
	}
	order, orderItems, err := a.svc.CompleteRepDelivery(r.Context(), claims.UserID, id, service.CompleteDeliveryInput{
		Items: items, Note: req.Note, AmountCollectedMinor: req.AmountCollectedMinor, PaymentReceived: req.PaymentReceived,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, clientOrderDTO(*order, orderItems, nil))
}

func (a *API) getDebtBalance(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err1 := uuid.Parse(r.URL.Query().Get("organization_id"))
	clientUserID, err2 := uuid.Parse(r.URL.Query().Get("client_user_id"))
	if err1 != nil || err2 != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("organization_id and client_user_id are required"))
		return
	}
	balance, err := a.svc.GetDebtBalance(r.Context(), claims.UserID, orgID, clientUserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"organization_id": orgID.String(), "client_user_id": clientUserID.String(), "balance_minor": balance,
	})
}

func (a *API) validateProductImport(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.URL.Query().Get("organization_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("organization_id is required"))
		return
	}
	body, err := service.ReadImportBody(r.Body)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("failed to read body"))
		return
	}
	job, report, err := a.svc.ValidateProductImport(r.Context(), claims.UserID, orgID, body)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{
		"id": job.ID.String(), "status": job.Status, "checksum": job.Checksum, "report": report,
	})
}

func (a *API) applyProductImport(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	jobID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var locationID *uuid.UUID
	if v := r.URL.Query().Get("location_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid location_id"))
			return
		}
		locationID = &id
	}
	var req struct {
		LocationID *string `json:"location_id"`
	}
	if r.ContentLength > 0 {
		_ = httpx.DecodeJSON(r, &req)
		if req.LocationID != nil && *req.LocationID != "" {
			id, err := uuid.Parse(*req.LocationID)
			if err != nil {
				httpx.WriteError(w, r, a.log, apperr.Validation("invalid location_id"))
				return
			}
			locationID = &id
		}
	}
	job, err := a.svc.ApplyProductImport(r.Context(), claims.UserID, jobID, service.ApplyImportInput{LocationID: locationID})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	var report any
	_ = jsonUnmarshal(job.Report, &report)
	httpx.JSON(w, http.StatusOK, map[string]any{
		"id": job.ID.String(), "status": job.Status, "report": report,
	})
}

func (a *API) productImportTemplate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	_, _ = io.WriteString(w, a.svc.ProductImportTemplate())
}

func cartDTO(c service.CartResult) map[string]any {
	items := make([]map[string]any, 0, len(c.Items))
	var totalMinor int64
	suppliers := map[string]struct{}{}
	for _, it := range c.Items {
		lineTotal := int64(it.Qty*float64(it.CartPriceMinor) + 0.5)
		totalMinor += lineTotal
		suppliers[it.OrganizationID.String()] = struct{}{}
		priceChanged := it.CartPriceMinor != it.CurrentPriceMinor
		items = append(items, map[string]any{
			"product_id": it.ProductID.String(), "qty": it.Qty, "brand": it.Brand, "name": it.Name,
			"sku": it.SKU, "unit": it.Unit, "price_minor": it.CartPriceMinor, "current_price_minor": it.CurrentPriceMinor,
			"price_changed": priceChanged, "currency": it.Currency, "organization_id": it.OrganizationID.String(),
			"available": it.Available, "line_total_minor": lineTotal,
		})
	}
	multiSupplier := len(suppliers) > 1
	return map[string]any{
		"id": c.Cart.ID.String(), "updated_at": c.Cart.UpdatedAt, "items": items, "total_minor": totalMinor,
		"multi_supplier": multiSupplier,
	}
}

func clientOrderSummaryDTO(o domain.ClientOrder) map[string]any {
	var pickup any
	if o.PickupBranchID != nil {
		pickup = o.PickupBranchID.String()
	}
	return map[string]any{
		"id": o.ID.String(), "order_number": domain.FormatClientOrderNumber(o.ID, o.CreatedAt),
		"status": o.Status, "total_minor": o.TotalMinor, "currency": o.Currency,
		"supplier_org_id": o.SupplierOrgID.String(), "created_at": o.CreatedAt, "updated_at": o.UpdatedAt,
		"delivery_address": o.DeliveryAddress, "payment_method": o.PaymentMethod, "payment_status": o.PaymentStatus,
		"pickup_branch_id": pickup,
	}
}

func clientOrderDTO(o domain.ClientOrder, items []domain.ClientOrderItem, history []domain.ClientOrderStatusHistory) map[string]any {
	itemsOut := make([]map[string]any, 0, len(items))
	for _, it := range items {
		itemsOut = append(itemsOut, map[string]any{
			"id": it.ID.String(), "product_id": it.ProductID.String(), "product_name": it.ProductName,
			"brand": it.Brand, "qty": it.Qty, "price_minor": it.PriceMinor, "qty_delivered": it.QtyDelivered,
		})
	}
	var repUser any
	if o.RepUserID != nil {
		repUser = o.RepUserID.String()
	}
	var deliveredAt any
	if o.DeliveredAt != nil {
		deliveredAt = *o.DeliveredAt
	}
	var pickup any
	if o.PickupBranchID != nil {
		pickup = o.PickupBranchID.String()
	}
	historyOut := make([]map[string]any, 0)
	if history != nil {
		for _, h := range history {
			historyOut = append(historyOut, map[string]any{
				"from_status": h.FromStatus, "to_status": h.ToStatus,
				"created_at": h.CreatedAt, "note": h.Note,
			})
		}
	}
	return map[string]any{
		"id": o.ID.String(), "order_number": domain.FormatClientOrderNumber(o.ID, o.CreatedAt),
		"user_id": o.UserID.String(), "supplier_org_id": o.SupplierOrgID.String(),
		"status": o.Status, "currency": o.Currency, "total_minor": o.TotalMinor,
		"delivery_address": o.DeliveryAddress, "delivery_comment": o.DeliveryComment,
		"payment_method": o.PaymentMethod, "payment_status": o.PaymentStatus,
		"rep_user_id": repUser, "delivered_at": deliveredAt,
		"delivery_note": o.DeliveryNote, "amount_collected_minor": o.AmountCollectedMinor,
		"pickup_branch_id": pickup, "created_at": o.CreatedAt, "updated_at": o.UpdatedAt,
		"items": itemsOut, "status_history": historyOut,
	}
}

func checkoutResultDTO(r service.CheckoutResult) map[string]any {
	ordersOut := make([]map[string]any, 0, len(r.Orders))
	for _, o := range r.Orders {
		ordersOut = append(ordersOut, clientOrderDTO(o.Order, o.Items, nil))
	}
	var first map[string]any
	if len(ordersOut) > 0 {
		first = ordersOut[0]
	}
	return map[string]any{
		"checkout_group_id": r.GroupID.String(),
		"total_minor":       r.TotalMinor,
		"orders":            ordersOut,
		"order":             first,
	}
}

func (a *API) listSalonPickupOrders(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	branchID, err := uuid.Parse(r.URL.Query().Get("branch_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("branch_id is required"))
		return
	}
	orders, err := a.svc.ListSalonPickupOrders(r.Context(), claims.UserID, branchID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(orders))
	for _, o := range orders {
		items, _ := a.svc.ClientOrderItems(r.Context(), o.ID)
		out = append(out, clientOrderDTO(o, items, nil))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) acceptSalonPickupOrder(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	order, err := a.svc.AcceptSalonPickupOrder(r.Context(), claims.UserID, id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	items, _ := a.svc.ClientOrderItems(r.Context(), id)
	httpx.JSON(w, http.StatusOK, clientOrderDTO(*order, items, nil))
}

func (a *API) handoverSalonPickupOrder(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		PaymentReceived      bool  `json:"payment_received"`
		AmountCollectedMinor int64 `json:"amount_collected_minor"`
	}
	_ = httpx.DecodeJSON(r, &req)
	order, err := a.svc.HandoverSalonPickupOrder(r.Context(), claims.UserID, id, service.HandoverPickupInput{
		PaymentReceived: req.PaymentReceived, AmountCollectedMinor: req.AmountCollectedMinor,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	items, _ := a.svc.ClientOrderItems(r.Context(), id)
	httpx.JSON(w, http.StatusOK, clientOrderDTO(*order, items, nil))
}

func jsonUnmarshal(data []byte, v any) error {
	if len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, v)
}
