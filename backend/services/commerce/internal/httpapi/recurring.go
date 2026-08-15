package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerRecurringRoutes(mux *http.ServeMux, auth func(http.Handler) http.Handler) {
	mux.Handle("POST /v1/commerce/recurring", auth(http.HandlerFunc(a.createRecurring)))
	mux.Handle("GET /v1/commerce/recurring", auth(http.HandlerFunc(a.listRecurring)))
	mux.Handle("POST /v1/commerce/recurring/{id}/decide", auth(http.HandlerFunc(a.decideRecurring)))
	mux.Handle("POST /v1/commerce/recurring/{id}/status", auth(http.HandlerFunc(a.statusRecurring)))
}

func recurringDTO(a store.RecurringAgreement) map[string]any {
	items := make([]map[string]any, 0, len(a.Items))
	for _, it := range a.Items {
		items = append(items, map[string]any{
			"product_id": it.ProductID.String(), "qty": it.Qty, "last_known_price_minor": it.LastKnownPriceMinor,
		})
	}
	return map[string]any{
		"id": a.ID.String(), "supplier_org_id": a.SupplierOrgID.String(), "buyer_org_id": a.BuyerOrgID.String(),
		"pickup_branch_id": a.PickupBranchID.String(), "frequency": a.Frequency, "status": a.Status,
		"start_date": a.StartDate.Format("2006-01-02"), "horizon_days": a.HorizonDays, "items": items,
		"created_at": a.CreatedAt,
	}
}

func (a *API) createRecurring(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		SupplierOrgID    string `json:"supplier_org_id"`
		BuyerOrgID       string `json:"buyer_org_id"`
		PickupBranchID   string `json:"pickup_branch_id"`
		Frequency        string `json:"frequency"`
		PreferredWeekday *int   `json:"preferred_weekday"`
		StartDate        string `json:"start_date"`
		HorizonDays      int    `json:"horizon_days"`
		Items            []struct {
			ProductID string  `json:"product_id"`
			Qty       float64 `json:"qty"`
		} `json:"items"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	sup, err1 := uuid.Parse(req.SupplierOrgID)
	buy, err2 := uuid.Parse(req.BuyerOrgID)
	br, err3 := uuid.Parse(req.PickupBranchID)
	if err1 != nil || err2 != nil || err3 != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid ids"))
		return
	}
	start, err := time.Parse("2006-01-02", req.StartDate)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("start_date must be YYYY-MM-DD"))
		return
	}
	in := service.CreateRecurringInput{
		SupplierOrgID: sup, BuyerOrgID: buy, PickupBranchID: br, Frequency: req.Frequency,
		PreferredWeekday: req.PreferredWeekday, StartDate: start, HorizonDays: req.HorizonDays,
	}
	for _, it := range req.Items {
		pid, err := uuid.Parse(it.ProductID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid product_id"))
			return
		}
		in.Items = append(in.Items, service.RecurringItemIn{ProductID: pid, Qty: it.Qty})
	}
	item, err := a.svc.CreateRecurring(r.Context(), claims.UserID, in)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, recurringDTO(*item))
}

func (a *API) listRecurring(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.URL.Query().Get("organization_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("organization_id is required"))
		return
	}
	asSupplier := strings.EqualFold(r.URL.Query().Get("role"), "supplier")
	items, err := a.svc.ListRecurring(r.Context(), claims.UserID, orgID, asSupplier)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		out = append(out, recurringDTO(it))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) decideRecurring(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Action string `json:"action"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	approve := strings.EqualFold(req.Action, "approve")
	item, err := a.svc.DecideRecurring(r.Context(), claims.UserID, id, approve)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, recurringDTO(*item))
}

func (a *API) statusRecurring(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	item, err := a.svc.SetRecurringStatus(r.Context(), claims.UserID, id, req.Status)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, recurringDTO(*item))
}
