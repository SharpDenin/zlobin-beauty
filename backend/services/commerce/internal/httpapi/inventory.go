package httpapi

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerInventoryRoutes(mux *http.ServeMux, auth func(http.Handler) http.Handler) {
	mux.Handle("GET /v1/me/inventory", auth(http.HandlerFunc(a.myInventory)))
	mux.Handle("GET /v1/me/inventory/movements", auth(http.HandlerFunc(a.myInventoryMovements)))
	mux.Handle("GET /v1/me/inventory/receipts", auth(http.HandlerFunc(a.myInventoryReceipts)))
	mux.Handle("GET /v1/me/inventory/receipts/{orderID}", auth(http.HandlerFunc(a.myInventoryReceipt)))
	mux.Handle("POST /v1/me/inventory/consume", auth(http.HandlerFunc(a.myInventoryConsume)))
	mux.Handle("POST /v1/me/inventory/adjust", auth(http.HandlerFunc(a.myInventoryAdjust)))
	mux.Handle("GET /v1/me/inventory/{productID}", auth(http.HandlerFunc(a.myInventoryItem)))
}

func parseOrgID(r *http.Request) (uuid.UUID, error) {
	orgID, err := uuid.Parse(r.URL.Query().Get("organization_id"))
	if err != nil {
		return uuid.Nil, apperr.Validation("organization_id is required")
	}
	return orgID, nil
}

func (a *API) myInventory(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := parseOrgID(r)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	loc, items, err := a.svc.ListMyInventory(r.Context(), claims.UserID, orgID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, v := range items {
		out = append(out, stockItemDTO(v))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"location": locationDTO(*loc),
		"items":    out,
	})
}

func (a *API) myInventoryItem(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := parseOrgID(r)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	productID, err := uuid.Parse(r.PathValue("productID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid product_id"))
		return
	}
	loc, item, movements, err := a.svc.GetMyInventoryItem(r.Context(), claims.UserID, orgID, productID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	names := a.svc.SupplierNamesForMovements(r.Context(), movements)
	mv := make([]map[string]any, 0, len(movements))
	for _, m := range movements {
		dto := movementDTO(m)
		if m.RefID != nil {
			if name := names[m.RefID.String()]; name != "" {
				dto["supplier_name"] = name
			}
		}
		mv = append(mv, dto)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"location":  locationDTO(*loc),
		"item":      stockItemDTO(*item),
		"movements": mv,
	})
}

func (a *API) myInventoryMovements(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := parseOrgID(r)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	var productID *uuid.UUID
	if v := r.URL.Query().Get("product_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid product_id"))
			return
		}
		productID = &id
	}
	_, items, err := a.svc.ListMyMovements(r.Context(), claims.UserID, orgID, productID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, m := range items {
		out = append(out, movementDTO(m))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) myInventoryReceipts(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := parseOrgID(r)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	pendingOnly := r.URL.Query().Get("history") != "1"
	items, err := a.svc.ListMyReceipts(r.Context(), claims.UserID, orgID, pendingOnly)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		out = append(out, receiptDTO(it))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) myInventoryReceipt(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := parseOrgID(r)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	orderID, err := uuid.Parse(r.PathValue("orderID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid order_id"))
		return
	}
	item, err := a.svc.GetMyReceipt(r.Context(), claims.UserID, orgID, orderID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, receiptDTO(*item))
}

func receiptDTO(it service.PendingReceipt) map[string]any {
	dto := orderDTO(it.Order, it.Items)
	dto["supplier_name"] = it.SupplierName
	dto["acceptance_state"] = it.AcceptanceState
	remaining := 0.0
	undelivered := 0.0
	itemsOut := make([]map[string]any, 0, len(it.Items))
	rawItems, _ := dto["items"].([]map[string]any)
	for i, line := range it.Items {
		row := map[string]any{}
		if i < len(rawItems) {
			row = rawItems[i]
		}
		rem := domain.DispositionRemaining(line.QtyOrdered, line.QtyAccepted, line.QtyDamaged, line.QtyRejected)
		recv := domain.LineReceivable(line.QtyOrdered, line.QtyDelivered, line.QtyAccepted, line.QtyDamaged, line.QtyRejected)
		und := domain.DispositionUndelivered(line.QtyOrdered, line.QtyDelivered)
		row["remaining_qty"] = rem
		row["receivable_qty"] = recv
		row["undelivered_qty"] = und
		remaining += rem
		undelivered += und
		itemsOut = append(itemsOut, row)
	}
	dto["items"] = itemsOut
	dto["remaining_qty"] = remaining
	dto["undelivered_qty"] = undelivered
	return dto
}

func (a *API) myInventoryConsume(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		OrganizationID string  `json:"organization_id"`
		ProductID      string  `json:"product_id"`
		Qty            float64 `json:"qty"`
		AppointmentID  *string `json:"appointment_id"`
		ServiceID      *string `json:"service_id"`
		IdempotencyKey string  `json:"idempotency_key"`
		Reason         string  `json:"reason"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	orgID, err := uuid.Parse(req.OrganizationID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid organization_id"))
		return
	}
	productID, err := uuid.Parse(req.ProductID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid product_id"))
		return
	}
	appt, err := parseOptionalUUID(req.AppointmentID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid appointment_id"))
		return
	}
	svcID, err := parseOptionalUUID(req.ServiceID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid service_id"))
		return
	}
	m, err := a.svc.ConsumeMyStock(r.Context(), claims.UserID, service.ConsumeStockInput{
		OrganizationID: orgID, ProductID: productID, Qty: req.Qty,
		AppointmentID: appt, ServiceID: svcID,
		IdempotencyKey: req.IdempotencyKey, Reason: req.Reason,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, movementDTO(*m))
}

func (a *API) myInventoryAdjust(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		OrganizationID string  `json:"organization_id"`
		ProductID      string  `json:"product_id"`
		Qty            float64 `json:"qty"`
		Reason         string  `json:"reason"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	orgID, err := uuid.Parse(req.OrganizationID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid organization_id"))
		return
	}
	productID, err := uuid.Parse(req.ProductID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid product_id"))
		return
	}
	m, err := a.svc.AdjustMyStock(r.Context(), claims.UserID, service.AdjustStockInput{
		OrganizationID: orgID, ProductID: productID, Qty: req.Qty, Reason: req.Reason,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, movementDTO(*m))
}

func stockItemDTO(v domain.StockBalanceView) map[string]any {
	available := v.QtyOnHand - v.QtyReserved
	var photo any
	if v.PhotoMediaID != nil {
		photo = v.PhotoMediaID.String()
	}
	return map[string]any{
		"location_id": v.LocationID.String(), "product_id": v.ProductID.String(),
		"qty_on_hand": v.QtyOnHand, "qty_reserved": v.QtyReserved, "available": available,
		"qty_incoming": v.QtyIncoming,
		"product_name": v.ProductName, "brand": v.ProductBrand, "sku": v.ProductSKU,
		"unit": v.Unit, "volume_label": v.VolumeLabel,
		"min_stock": v.MinStock, "price_minor": v.PriceMinor, "currency": v.Currency,
		"status": v.Status, "updated_at": v.UpdatedAt, "photo_media_id": photo,
	}
}
