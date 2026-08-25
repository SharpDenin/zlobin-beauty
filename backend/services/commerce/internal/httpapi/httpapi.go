package httpapi

import (
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

type API struct {
	svc           *service.Service
	log           *slog.Logger
	internalToken string
	allowDev      bool
}

func New(svc *service.Service, log *slog.Logger, internalToken string) *API {
	env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	return &API{svc: svc, log: log, internalToken: internalToken, allowDev: env != "production"}
}

func (a *API) Routes(mux *http.ServeMux, jwtSecret string) {
	auth := httpx.BearerAuth(jwtSecret)
	internal := httpx.InternalAuth(a.internalToken)
	mux.Handle("POST /v1/commerce/locations", auth(http.HandlerFunc(a.createLocation)))
	mux.Handle("GET /v1/commerce/locations", auth(http.HandlerFunc(a.listLocations)))
	mux.Handle("POST /v1/commerce/products", auth(http.HandlerFunc(a.createProduct)))
	mux.Handle("GET /v1/commerce/products", auth(http.HandlerFunc(a.listProducts)))
	mux.Handle("GET /v1/commerce/products/{id}", auth(http.HandlerFunc(a.getProduct)))
	mux.Handle("PUT /v1/commerce/products/{id}", auth(http.HandlerFunc(a.updateProduct)))
	mux.Handle("GET /v1/commerce/catalog/suppliers/{orgID}/products", auth(http.HandlerFunc(a.listCatalogProducts)))
	mux.Handle("POST /v1/commerce/stock/movements", auth(http.HandlerFunc(a.createMovement)))
	mux.Handle("GET /v1/commerce/stock/movements", auth(http.HandlerFunc(a.listMovements)))
	mux.Handle("GET /v1/commerce/stock", auth(http.HandlerFunc(a.listStock)))
	mux.Handle("GET /v1/commerce/stock/forecast", auth(http.HandlerFunc(a.stockForecast)))
	mux.Handle("POST /v1/commerce/norms", auth(http.HandlerFunc(a.createNorm)))
	mux.Handle("GET /v1/commerce/norms", auth(http.HandlerFunc(a.listNorms)))
	mux.Handle("GET /v1/commerce/product-categories", auth(http.HandlerFunc(a.listProductCategories)))
	mux.Handle("POST /v1/commerce/product-categories", auth(http.HandlerFunc(a.createProductCategory)))
	mux.Handle("PUT /v1/commerce/product-categories/{id}", auth(http.HandlerFunc(a.updateProductCategory)))
	mux.Handle("DELETE /v1/commerce/product-categories/{id}", auth(http.HandlerFunc(a.deleteProductCategory)))
	mux.Handle("GET /v1/commerce/units", auth(http.HandlerFunc(a.listUnits)))
	mux.Handle("POST /v1/commerce/units", auth(http.HandlerFunc(a.createUnit)))
	mux.Handle("PUT /v1/commerce/units/{id}", auth(http.HandlerFunc(a.updateUnit)))
	mux.Handle("DELETE /v1/commerce/units/{id}", auth(http.HandlerFunc(a.deleteUnit)))
	mux.Handle("POST /v1/internal/stock/consume-appointment", internal(http.HandlerFunc(a.consumeAppointment)))
	mux.Handle("POST /v1/internal/inventory/repeat-availability", internal(http.HandlerFunc(a.internalRepeatAvailability)))
	mux.Handle("GET /v1/internal/products/{id}", internal(http.HandlerFunc(a.internalGetProduct)))
	mux.Handle("GET /v1/commerce/supplier/dashboard", auth(http.HandlerFunc(a.supplierDashboard)))
	mux.Handle("GET /v1/commerce/supplier/analytics", auth(http.HandlerFunc(a.supplierAnalytics)))
	mux.Handle("POST /v1/commerce/dev/backdate", auth(http.HandlerFunc(a.devBackdate)))
	mux.Handle("POST /v1/commerce/supplier-orders", auth(http.HandlerFunc(a.createSupplierOrder)))
	mux.Handle("GET /v1/commerce/supplier-orders", auth(http.HandlerFunc(a.listSupplierOrders)))
	mux.Handle("GET /v1/commerce/supplier-orders/{id}", auth(http.HandlerFunc(a.getSupplierOrder)))
	mux.Handle("POST /v1/commerce/supplier-orders/{id}/transition", auth(http.HandlerFunc(a.transitionSupplierOrder)))
	mux.Handle("POST /v1/commerce/supplier-orders/{id}/accept", auth(http.HandlerFunc(a.acceptSupplierOrder)))
	mux.Handle("POST /v1/commerce/supplier-orders/{id}/mark-paid", auth(http.HandlerFunc(a.markSupplierOrderPaid)))
	mux.Handle("GET /v1/commerce/supplier-orders/{id}/delivery", auth(http.HandlerFunc(a.getOrderDelivery)))
	mux.Handle("POST /v1/commerce/supplier-orders/{id}/delivery/schedule", auth(http.HandlerFunc(a.scheduleOrderDelivery)))
	mux.Handle("PATCH /v1/commerce/supplier-orders/{id}/delivery/schedule", auth(http.HandlerFunc(a.scheduleOrderDelivery)))
	mux.Handle("POST /v1/commerce/supplier-orders/{id}/delivery/preparing", auth(http.HandlerFunc(a.transitionDeliveryPreparing)))
	mux.Handle("POST /v1/commerce/supplier-orders/{id}/delivery/in-transit", auth(http.HandlerFunc(a.transitionDeliveryInTransit)))
	mux.Handle("POST /v1/commerce/supplier-orders/{id}/delivery/arrived", auth(http.HandlerFunc(a.transitionDeliveryArrived)))
	mux.Handle("POST /v1/commerce/supplier-orders/{id}/delivery/delivered", auth(http.HandlerFunc(a.transitionDeliveryDelivered)))
	mux.Handle("POST /v1/commerce/supplier-orders/{id}/delivery/fail", auth(http.HandlerFunc(a.transitionDeliveryFail)))
	mux.Handle("POST /v1/commerce/supplier-orders/{id}/delivery/cancel", auth(http.HandlerFunc(a.transitionDeliveryCancel)))
	// legacy paths (Stage 3 early wiring)
	mux.Handle("POST /v1/commerce/supplier/orders", auth(http.HandlerFunc(a.createSupplierOrder)))
	mux.Handle("GET /v1/commerce/supplier/orders", auth(http.HandlerFunc(a.listSupplierOrders)))
	mux.Handle("POST /v1/commerce/supplier/orders/{id}/confirm", auth(http.HandlerFunc(a.confirmSupplierOrder)))
	mux.Handle("POST /v1/commerce/supplier/orders/{id}/accept", auth(http.HandlerFunc(a.acceptSupplierOrderLegacy)))
	a.registerShopRoutes(mux, auth)
	a.registerRecommendationRoutes(mux, auth)
	a.registerRecurringRoutes(mux, auth)
	a.registerInventoryRoutes(mux, auth)
}

// --- locations ---

func (a *API) createLocation(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		OrganizationID string `json:"organization_id"`
		Name           string `json:"name"`
		Kind           string `json:"kind"`
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
	loc, err := a.svc.CreateLocation(r.Context(), claims.UserID, orgID, req.Name, req.Kind)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, locationDTO(*loc))
}

func (a *API) listLocations(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.URL.Query().Get("organization_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("organization_id is required"))
		return
	}
	items, err := a.svc.ListLocations(r.Context(), claims.UserID, orgID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, l := range items {
		out = append(out, locationDTO(l))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func locationDTO(l domain.StockLocation) map[string]any {
	var owner any
	if l.OwnerUserID != nil {
		owner = l.OwnerUserID.String()
	}
	return map[string]any{
		"id": l.ID.String(), "organization_id": l.OrganizationID.String(), "name": l.Name, "kind": l.Kind,
		"owner_user_id": owner, "created_at": l.CreatedAt,
	}
}

// --- products ---

func (a *API) createProduct(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		OrganizationID string  `json:"organization_id"`
		ParentID       *string `json:"parent_id"`
		CategoryID     *string `json:"category_id"`
		Brand          string  `json:"brand"`
		Name           string  `json:"name"`
		SKU            string  `json:"sku"`
		Description    string  `json:"description"`
		Unit           string  `json:"unit"`
		VolumeLabel    string  `json:"volume_label"`
		PriceMinor     int64   `json:"price_minor"`
		Currency       string  `json:"currency"`
		MinStock       float64 `json:"min_stock"`
		Published      bool    `json:"published"`
		ForSale        *bool   `json:"for_sale"`
		DeliveryDays   *int    `json:"delivery_days"`
		PhotoMediaID   *string `json:"photo_media_id"`
		Audience       string  `json:"audience"`
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
	categoryID, err := parseOptionalUUID(req.CategoryID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid category_id"))
		return
	}
	parentID, err := parseOptionalUUID(req.ParentID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid parent_id"))
		return
	}
	photoMediaID, err := parseOptionalUUID(req.PhotoMediaID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid photo_media_id"))
		return
	}
	forSale := true
	if req.ForSale != nil {
		forSale = *req.ForSale
	}
	deliveryDays := 3
	if req.DeliveryDays != nil {
		deliveryDays = *req.DeliveryDays
	}
	p, err := a.svc.CreateProduct(r.Context(), claims.UserID, service.ProductInput{
		OrganizationID: orgID, ParentID: parentID, CategoryID: categoryID, Brand: req.Brand, Name: req.Name, SKU: req.SKU,
		Description: req.Description, Unit: req.Unit, VolumeLabel: req.VolumeLabel, PriceMinor: req.PriceMinor,
		Currency: req.Currency, MinStock: req.MinStock, Published: req.Published,
		ForSale: forSale, DeliveryDays: deliveryDays, PhotoMediaID: photoMediaID, Audience: req.Audience,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, productDTO(*p))
}

func (a *API) listProducts(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.URL.Query().Get("organization_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("organization_id is required"))
		return
	}
	items, err := a.svc.ListProducts(r.Context(), claims.UserID, orgID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, p := range items {
		out = append(out, productDTO(p))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) listCatalogProducts(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid organization id"))
		return
	}
	items, err := a.svc.ListProducts(r.Context(), claims.UserID, orgID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	prof := false
	if claims != nil {
		for _, r := range claims.Roles {
			switch r {
			case "master", "supplier", "supplier_rep", "salon_owner", "salon_admin", "system_admin":
				prof = true
			}
		}
	}
	out := make([]map[string]any, 0, len(items))
	for _, p := range items {
		if !domain.ProductVisibleTo(p.Audience, prof) {
			continue
		}
		out = append(out, productDTO(p))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) getProduct(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	p, err := a.svc.GetProduct(r.Context(), claims.UserID, id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, productDTO(*p))
}

func (a *API) internalGetProduct(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	p, err := a.svc.GetProductInternal(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	var categoryID any
	if p.CategoryID != nil {
		categoryID = p.CategoryID.String()
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"id": p.ID.String(), "organization_id": p.OrganizationID.String(),
		"name": p.Name, "brand": p.Brand, "category_id": categoryID,
	})
}

func (a *API) updateProduct(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		CategoryID   *string  `json:"category_id"`
		Brand        *string  `json:"brand"`
		Name         *string  `json:"name"`
		SKU          *string  `json:"sku"`
		Description  *string  `json:"description"`
		Unit         *string  `json:"unit"`
		VolumeLabel  *string  `json:"volume_label"`
		PriceMinor   *int64   `json:"price_minor"`
		Currency     *string  `json:"currency"`
		MinStock     *float64 `json:"min_stock"`
		Published    *bool    `json:"published"`
		ForSale      *bool    `json:"for_sale"`
		DeliveryDays *int     `json:"delivery_days"`
		PhotoMediaID *string  `json:"photo_media_id"`
		Audience     *string  `json:"audience"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	categoryID, err := parseOptionalUUID(req.CategoryID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid category_id"))
		return
	}
	patch := service.ProductPatch{
		Brand: req.Brand, Name: req.Name, SKU: req.SKU, Description: req.Description, Unit: req.Unit,
		VolumeLabel: req.VolumeLabel, PriceMinor: req.PriceMinor, Currency: req.Currency, MinStock: req.MinStock,
		Published: req.Published, ForSale: req.ForSale, DeliveryDays: req.DeliveryDays, Audience: req.Audience,
	}
	if req.CategoryID != nil {
		patch.CategoryID = categoryID
	}
	if req.PhotoMediaID != nil {
		if *req.PhotoMediaID == "" {
			patch.ClearPhoto = true
		} else {
			photoID, err := uuid.Parse(*req.PhotoMediaID)
			if err != nil {
				httpx.WriteError(w, r, a.log, apperr.Validation("invalid photo_media_id"))
				return
			}
			patch.PhotoMediaID = &photoID
		}
	}
	p, err := a.svc.UpdateProduct(r.Context(), claims.UserID, id, patch)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, productDTO(*p))
}

func productDTO(p domain.Product) map[string]any {
	var category any
	if p.CategoryID != nil {
		category = p.CategoryID.String()
	}
	var parent any
	if p.ParentID != nil {
		parent = p.ParentID.String()
	}
	var photo any
	if p.PhotoMediaID != nil {
		photo = p.PhotoMediaID.String()
	}
	return map[string]any{
		"id": p.ID.String(), "organization_id": p.OrganizationID.String(), "parent_id": parent, "category_id": category,
		"brand": p.Brand, "name": p.Name, "sku": p.SKU, "description": p.Description, "unit": p.Unit,
		"volume_label": p.VolumeLabel, "price_minor": p.PriceMinor, "currency": p.Currency,
		"min_stock": p.MinStock, "published": p.Published, "for_sale": p.ForSale, "delivery_days": p.DeliveryDays,
		"photo_media_id": photo, "audience": p.Audience, "created_at": p.CreatedAt, "updated_at": p.UpdatedAt,
	}
}

// --- stock ---

func (a *API) createMovement(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		LocationID string  `json:"location_id"`
		ProductID  string  `json:"product_id"`
		Kind       string  `json:"kind"`
		Qty        float64 `json:"qty"`
		Reason     string  `json:"reason"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	locID, err1 := uuid.Parse(req.LocationID)
	prodID, err2 := uuid.Parse(req.ProductID)
	if err1 != nil || err2 != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid location_id or product_id"))
		return
	}
	m, err := a.svc.CreateMovement(r.Context(), claims.UserID, service.MovementInput{
		LocationID: locID, ProductID: prodID, Kind: req.Kind, Qty: req.Qty, Reason: req.Reason,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, movementDTO(*m))
}

func (a *API) listMovements(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	locID, err := uuid.Parse(r.URL.Query().Get("location_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("location_id is required"))
		return
	}
	items, err := a.svc.ListMovements(r.Context(), claims.UserID, locID)
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

func movementDTO(m domain.StockMovement) map[string]any {
	var refID any
	if m.RefID != nil {
		refID = m.RefID.String()
	}
	return map[string]any{
		"id": m.ID.String(), "location_id": m.LocationID.String(), "product_id": m.ProductID.String(),
		"kind": m.Kind, "qty": m.Qty, "qty_before": m.QtyBefore, "qty_after": m.QtyAfter, "reason": m.Reason,
		"actor_user_id": m.ActorUserID.String(), "ref_type": m.RefType, "ref_id": refID,
		"idempotency_key": m.IdempotencyKey, "created_at": m.CreatedAt,
	}
}

func (a *API) listStock(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	locID, err := uuid.Parse(r.URL.Query().Get("location_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("location_id is required"))
		return
	}
	items, err := a.svc.ListStock(r.Context(), claims.UserID, locID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, v := range items {
		out = append(out, stockItemDTO(v))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) stockForecast(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	locID, err := uuid.Parse(r.URL.Query().Get("location_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("location_id is required"))
		return
	}
	from := time.Now().UTC()
	to := from.AddDate(0, 0, 7)
	if v := r.URL.Query().Get("from"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid from (use RFC3339)"))
			return
		}
		from = t.UTC()
	}
	if v := r.URL.Query().Get("to"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid to (use RFC3339)"))
			return
		}
		to = t.UTC()
	}
	rows, err := a.svc.StockForecast(r.Context(), claims.UserID, locID, from, to)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, map[string]any{
			"product_id": row.ProductID.String(), "product_name": row.ProductName,
			"qty_on_hand": row.QtyOnHand, "qty_reserved": row.QtyReserved, "available": row.Available,
			"min_stock": row.MinStock, "demand": row.Demand, "deficit": row.Deficit, "explanation": row.Explanation,
		})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out, "from": from, "to": to})
}

// --- consumption norms ---

func (a *API) createNorm(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		OrganizationID string  `json:"organization_id"`
		ServiceID      string  `json:"service_id"`
		ProductID      string  `json:"product_id"`
		Qty            float64 `json:"qty"`
		Required       bool    `json:"required"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	orgID, err1 := uuid.Parse(req.OrganizationID)
	serviceID, err2 := uuid.Parse(req.ServiceID)
	productID, err3 := uuid.Parse(req.ProductID)
	if err1 != nil || err2 != nil || err3 != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid organization_id, service_id or product_id"))
		return
	}
	n, err := a.svc.CreateNorm(r.Context(), claims.UserID, orgID, serviceID, productID, req.Qty, req.Required)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, normDTO(*n))
}

func (a *API) listNorms(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.URL.Query().Get("organization_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("organization_id is required"))
		return
	}
	var serviceID *uuid.UUID
	if v := r.URL.Query().Get("service_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid service_id"))
			return
		}
		serviceID = &id
	}
	items, err := a.svc.ListNorms(r.Context(), claims.UserID, orgID, serviceID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, n := range items {
		out = append(out, normDTO(n))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func normDTO(n domain.ConsumptionNorm) map[string]any {
	return map[string]any{
		"id": n.ID.String(), "organization_id": n.OrganizationID.String(), "service_id": n.ServiceID.String(),
		"product_id": n.ProductID.String(), "qty": n.Qty, "required": n.Required, "created_at": n.CreatedAt,
	}
}

func (a *API) consumeAppointment(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OrganizationID string `json:"organization_id"`
		ServiceID      string `json:"service_id"`
		AppointmentID  string `json:"appointment_id"`
		ActorUserID    string `json:"actor_user_id"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	orgID, err1 := uuid.Parse(req.OrganizationID)
	serviceID, err2 := uuid.Parse(req.ServiceID)
	appointmentID, err3 := uuid.Parse(req.AppointmentID)
	actorUserID, err4 := uuid.Parse(req.ActorUserID)
	if err1 != nil || err2 != nil || err3 != nil || err4 != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid organization_id, service_id, appointment_id or actor_user_id"))
		return
	}
	if err := a.svc.ConsumeForAppointment(r.Context(), orgID, serviceID, appointmentID, actorUserID); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) internalRepeatAvailability(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OwnerUserID         string `json:"owner_user_id"`
		OrganizationID      string `json:"organization_id"`
		ServiceID           string `json:"service_id"`
		SourceAppointmentID string `json:"source_appointment_id"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	owner, err1 := uuid.Parse(req.OwnerUserID)
	orgID, err2 := uuid.Parse(req.OrganizationID)
	if err1 != nil || err2 != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid owner_user_id or organization_id"))
		return
	}
	var serviceID uuid.UUID
	if strings.TrimSpace(req.ServiceID) != "" {
		id, err := uuid.Parse(req.ServiceID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid service_id"))
			return
		}
		serviceID = id
	}
	var source *uuid.UUID
	if strings.TrimSpace(req.SourceAppointmentID) != "" {
		id, err := uuid.Parse(req.SourceAppointmentID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid source_appointment_id"))
			return
		}
		source = &id
	}
	items, err := a.svc.RepeatAvailability(r.Context(), service.RepeatAvailabilityInput{
		OwnerUserID: owner, OrganizationID: orgID, ServiceID: serviceID, SourceAppointmentID: source,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		row := map[string]any{
			"product_id": it.ProductID.String(), "product_name": it.Name, "brand": it.Brand, "unit": it.Unit,
			"required_qty": it.RequiredQty, "available_qty": it.AvailableQty, "incoming_qty": it.IncomingQty,
			"shortage_qty": it.ShortageQty, "status": it.Status,
		}
		if it.ExpectedAt != nil {
			row["expected_at"] = it.ExpectedAt.UTC()
		}
		out = append(out, row)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func productCategoryDTO(c domain.ProductCategory) map[string]any {
	return map[string]any{
		"id": c.ID.String(), "name": c.Name, "slug": c.Slug, "created_at": c.CreatedAt,
	}
}

func (a *API) listProductCategories(w http.ResponseWriter, r *http.Request) {
	items, err := a.svc.ListProductCategories(r.Context())
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, c := range items {
		out = append(out, productCategoryDTO(c))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) createProductCategory(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	c, err := a.svc.CreateProductCategory(r.Context(), claims, req.Name, req.Slug)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, productCategoryDTO(*c))
}

func (a *API) updateProductCategory(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	c, err := a.svc.UpdateProductCategory(r.Context(), claims, id, req.Name, req.Slug)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, productCategoryDTO(*c))
}

func (a *API) deleteProductCategory(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	if err := a.svc.DeleteProductCategory(r.Context(), claims, id); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func unitDTO(u domain.UnitOfMeasure) map[string]any {
	return map[string]any{
		"id": u.ID.String(), "code": u.Code, "name": u.Name, "created_at": u.CreatedAt,
	}
}

func (a *API) listUnits(w http.ResponseWriter, r *http.Request) {
	items, err := a.svc.ListUnits(r.Context())
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, u := range items {
		out = append(out, unitDTO(u))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) createUnit(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		Code string `json:"code"`
		Name string `json:"name"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	u, err := a.svc.CreateUnit(r.Context(), claims, req.Code, req.Name)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, unitDTO(*u))
}

func (a *API) updateUnit(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Code string `json:"code"`
		Name string `json:"name"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	u, err := a.svc.UpdateUnit(r.Context(), claims, id, req.Code, req.Name)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, unitDTO(*u))
}

func (a *API) deleteUnit(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	if err := a.svc.DeleteUnit(r.Context(), claims, id); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- supplier dashboard ---

func (a *API) supplierDashboard(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.URL.Query().Get("organization_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("organization_id is required"))
		return
	}
	to := time.Now().UTC()
	from := to.AddDate(0, 0, -30)
	if v := r.URL.Query().Get("from"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid from (use RFC3339)"))
			return
		}
		from = t.UTC()
	}
	if v := r.URL.Query().Get("to"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid to (use RFC3339)"))
			return
		}
		to = t.UTC()
	}
	res, err := a.svc.SupplierDashboard(r.Context(), claims.UserID, orgID, from, to)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	body := map[string]any{
		"organization_id":      res.OrganizationID.String(),
		"from":                 res.From,
		"to":                   res.To,
		"turnover_minor":       res.Current.TurnoverMinor,
		"orders_count":         res.Current.OrdersCount,
		"products_count":       res.Current.ProductsCount,
		"critical_stock_count": res.Current.CriticalStockCount,
	}
	if res.Previous != nil {
		body["previous"] = map[string]any{
			"turnover_minor": res.Previous.TurnoverMinor,
			"orders_count":   res.Previous.OrdersCount,
		}
		body["turnover_delta_percent"] = deltaPercent(res.Current.TurnoverMinor, res.Previous.TurnoverMinor)
		body["orders_delta_percent"] = deltaPercent(res.Current.OrdersCount, res.Previous.OrdersCount)
	}
	httpx.JSON(w, http.StatusOK, body)
}

func deltaPercent(current, previous int64) any {
	if previous == 0 {
		return nil
	}
	return float64(current-previous) / float64(previous) * 100
}

func (a *API) supplierAnalytics(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.URL.Query().Get("organization_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("organization_id is required"))
		return
	}
	from, to := parseAnalyticsRange(r)
	body, err := a.svc.SupplierAnalytics(r.Context(), claims.UserID, orgID, from, to)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, body)
}

func parseAnalyticsRange(r *http.Request) (time.Time, time.Time) {
	to := time.Now().UTC()
	from := to.AddDate(0, 0, -30)
	if v := r.URL.Query().Get("from"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			from = t.UTC()
		} else if t, err := time.Parse("2006-01-02", v); err == nil {
			from = t.UTC()
		}
	}
	if v := r.URL.Query().Get("to"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			to = t.UTC()
		} else if t, err := time.Parse("2006-01-02", v); err == nil {
			to = t.UTC().Add(24*time.Hour - time.Nanosecond)
		}
	}
	period := r.URL.Query().Get("period")
	now := time.Now().UTC()
	switch period {
	case "day":
		from = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		to = now
	case "week":
		from = now.AddDate(0, 0, -7)
		to = now
	case "month":
		from = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		to = now
	case "quarter":
		m := ((int(now.Month())-1)/3)*3 + 1
		from = time.Date(now.Year(), time.Month(m), 1, 0, 0, 0, 0, time.UTC)
		to = now
	}
	return from, to
}

func (a *API) devBackdate(w http.ResponseWriter, r *http.Request) {
	if !a.allowDev {
		httpx.WriteError(w, r, a.log, apperr.Forbidden("dev endpoint disabled"))
		return
	}
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		Kind      string `json:"kind"`
		OrderID   string `json:"order_id"`
		CreatedAt string `json:"created_at"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	id, err := uuid.Parse(req.OrderID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid order_id"))
		return
	}
	at, err := time.Parse(time.RFC3339, req.CreatedAt)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid created_at"))
		return
	}
	if err := a.svc.DevBackdate(r.Context(), claims.UserID, req.Kind, id, at.UTC()); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// --- supplier orders ---

func (a *API) createSupplierOrder(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		BuyerOrgID          string     `json:"buyer_org_id"`
		SupplierOrgID       string     `json:"supplier_org_id"`
		LocationID          string     `json:"location_id"`
		DestinationBranchID string     `json:"destination_branch_id"`
		PaymentMethod       string     `json:"payment_method"`
		DeliveryCostMinor   int64      `json:"delivery_cost_minor"`
		IdempotencyKey      string     `json:"idempotency_key"`
		Comment             string     `json:"comment"`
		DesiredAt           *time.Time `json:"desired_at"`
		Items               []struct {
			ProductID string  `json:"product_id"`
			Qty       float64 `json:"qty"`
		} `json:"items"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	buyerOrgID, err1 := uuid.Parse(req.BuyerOrgID)
	supplierOrgID, err2 := uuid.Parse(req.SupplierOrgID)
	locID, err3 := uuid.Parse(req.LocationID)
	if err1 != nil || err2 != nil || err3 != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid buyer_org_id, supplier_org_id or location_id"))
		return
	}
	var destBranchID uuid.UUID
	if req.DestinationBranchID != "" {
		id, err := uuid.Parse(req.DestinationBranchID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid destination_branch_id"))
			return
		}
		destBranchID = id
	}
	items := make([]service.OrderItemInput, 0, len(req.Items))
	for _, it := range req.Items {
		productID, err := uuid.Parse(it.ProductID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid item product_id"))
			return
		}
		items = append(items, service.OrderItemInput{ProductID: productID, QtyOrdered: it.Qty})
	}
	if req.IdempotencyKey == "" {
		req.IdempotencyKey = strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	}
	order, orderItems, err := a.svc.CreateSupplierOrder(r.Context(), claims.UserID, service.CreateOrderInput{
		BuyerOrgID: buyerOrgID, SupplierOrgID: supplierOrgID, LocationID: locID,
		DestinationBranchID: destBranchID, PaymentMethod: req.PaymentMethod,
		DeliveryCostMinor: req.DeliveryCostMinor, IdempotencyKey: req.IdempotencyKey,
		Comment: req.Comment, DesiredAt: req.DesiredAt, Items: items,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, orderDTO(*order, orderItems))
}

func (a *API) listSupplierOrders(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.URL.Query().Get("organization_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("organization_id is required"))
		return
	}
	asSupplier := r.URL.Query().Get("role") == "supplier"
	orders, err := a.svc.ListSupplierOrders(r.Context(), claims.UserID, orgID, asSupplier)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(orders))
	for _, o := range orders {
		items, err := a.svc.OrderItems(r.Context(), o.ID)
		if err != nil {
			httpx.WriteError(w, r, a.log, err)
			return
		}
		out = append(out, orderDTO(o, items))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) getSupplierOrder(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	o, items, err := a.svc.GetSupplierOrder(r.Context(), claims.UserID, id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, orderDTO(*o, items))
}

func (a *API) transitionSupplierOrder(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Status              string     `json:"status"`
		EstimatedDeliveryAt *time.Time `json:"estimated_delivery_at"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	o, err := a.svc.TransitionSupplierOrder(r.Context(), claims.UserID, id, req.Status, req.EstimatedDeliveryAt)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	items, err := a.svc.OrderItems(r.Context(), o.ID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, orderDTO(*o, items))
}

func (a *API) confirmSupplierOrder(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	o, err := a.svc.ConfirmSupplierOrder(r.Context(), claims.UserID, id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	items, err := a.svc.OrderItems(r.Context(), o.ID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, orderDTO(*o, items))
}

func (a *API) acceptSupplierOrder(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		IdempotencyKey string `json:"idempotency_key"`
		Items          []struct {
			ProductID   string  `json:"product_id"`
			QtyAccepted float64 `json:"qty_accepted"`
			QtyDamaged  float64 `json:"qty_damaged"`
			QtyRejected float64 `json:"qty_rejected"`
		} `json:"items"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	accepted := make([]service.AcceptItemInput, 0, len(req.Items))
	for _, it := range req.Items {
		productID, err := uuid.Parse(it.ProductID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid product_id"))
			return
		}
		accepted = append(accepted, service.AcceptItemInput{
			ProductID: productID, QtyAccepted: it.QtyAccepted,
			QtyDamaged: it.QtyDamaged, QtyRejected: it.QtyRejected,
		})
	}
	idem := strings.TrimSpace(req.IdempotencyKey)
	if idem == "" {
		idem = strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	}
	o, items, err := a.svc.AcceptSupplierOrder(r.Context(), claims.UserID, id, accepted, idem)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, orderDTO(*o, items))
}

func (a *API) acceptSupplierOrderLegacy(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Items []struct {
			ID          string  `json:"id"`
			QtyAccepted float64 `json:"qty_accepted"`
		} `json:"items"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	orderItems, err := a.svc.OrderItems(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	byID := make(map[string]uuid.UUID, len(orderItems))
	for _, it := range orderItems {
		byID[it.ID.String()] = it.ProductID
	}
	accepted := make([]service.AcceptItemInput, 0, len(req.Items))
	for _, it := range req.Items {
		productID, ok := byID[it.ID]
		if !ok {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid item id"))
			return
		}
		accepted = append(accepted, service.AcceptItemInput{ProductID: productID, QtyAccepted: it.QtyAccepted})
	}
	o, items, err := a.svc.AcceptSupplierOrder(r.Context(), claims.UserID, id, accepted, strings.TrimSpace(r.Header.Get("Idempotency-Key")))
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, orderDTO(*o, items))
}

func (a *API) markSupplierOrderPaid(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	o, err := a.svc.MarkSupplierOrderPaid(r.Context(), claims.UserID, id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	items, err := a.svc.OrderItems(r.Context(), o.ID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, orderDTO(*o, items))
}

func (a *API) getOrderDelivery(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	d, err := a.svc.GetOrderDelivery(r.Context(), claims.UserID, id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, deliveryDTO(*d))
}

func (a *API) scheduleOrderDelivery(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		WindowStart       *time.Time `json:"window_start"`
		WindowEnd         *time.Time `json:"window_end"`
		PlannedDeliveryAt *time.Time `json:"planned_delivery_at"`
		RecipientName     string     `json:"recipient_name"`
		RecipientPhone    string     `json:"recipient_phone"`
		Comment           string     `json:"comment"`
		Provider          string     `json:"provider"`
		TrackingCode      string     `json:"tracking_code"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	d, err := a.svc.ScheduleOrderDelivery(r.Context(), claims.UserID, id, service.ScheduleDeliveryInput{
		WindowStart: req.WindowStart, WindowEnd: req.WindowEnd, PlannedDeliveryAt: req.PlannedDeliveryAt,
		RecipientName: req.RecipientName, RecipientPhone: req.RecipientPhone, Comment: req.Comment,
		Provider: req.Provider, TrackingCode: req.TrackingCode,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, deliveryDTO(*d))
}

func (a *API) transitionDeliveryPreparing(w http.ResponseWriter, r *http.Request) {
	a.transitionDelivery(w, r, domain.DeliveryStatusPreparing)
}
func (a *API) transitionDeliveryInTransit(w http.ResponseWriter, r *http.Request) {
	a.transitionDelivery(w, r, domain.DeliveryStatusInTransit)
}
func (a *API) transitionDeliveryArrived(w http.ResponseWriter, r *http.Request) {
	a.transitionDelivery(w, r, domain.DeliveryStatusArrived)
}
func (a *API) transitionDeliveryDelivered(w http.ResponseWriter, r *http.Request) {
	a.transitionDelivery(w, r, domain.DeliveryStatusDelivered)
}
func (a *API) transitionDeliveryFail(w http.ResponseWriter, r *http.Request) {
	a.transitionDelivery(w, r, domain.DeliveryStatusFailed)
}
func (a *API) transitionDeliveryCancel(w http.ResponseWriter, r *http.Request) {
	a.transitionDelivery(w, r, domain.DeliveryStatusCancelled)
}

func (a *API) transitionDelivery(w http.ResponseWriter, r *http.Request, toStatus string) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	d, err := a.svc.TransitionOrderDelivery(r.Context(), claims.UserID, id, toStatus)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, deliveryDTO(*d))
}

func orderDTO(o domain.SupplierOrder, items []domain.SupplierOrderItem) map[string]any {
	itemsOut := make([]map[string]any, 0, len(items))
	for _, it := range items {
		itemsOut = append(itemsOut, map[string]any{
			"id": it.ID.String(), "product_id": it.ProductID.String(),
			"product_name": it.ProductName, "product_sku": it.ProductSKU,
			"qty_ordered": it.QtyOrdered, "qty_delivered": it.QtyDelivered, "qty_accepted": it.QtyAccepted,
			"qty_damaged": it.QtyDamaged, "qty_rejected": it.QtyRejected,
			"price_minor": it.PriceMinor,
		})
	}
	var desiredAt any
	if o.DesiredAt != nil {
		desiredAt = *o.DesiredAt
	}
	var estimated any
	if o.EstimatedDeliveryAt != nil {
		estimated = *o.EstimatedDeliveryAt
	}
	var dest any
	if o.DestinationBranchID != nil {
		dest = o.DestinationBranchID.String()
	}
	var paidAt any
	if o.PaidAt != nil {
		paidAt = *o.PaidAt
	}
	return map[string]any{
		"id": o.ID.String(), "buyer_org_id": o.BuyerOrgID.String(), "supplier_org_id": o.SupplierOrgID.String(),
		"location_id": o.LocationID.String(), "destination_branch_id": dest,
		"status": o.Status, "currency": o.Currency,
		"total_minor": o.TotalMinor, "subtotal_minor": o.SubtotalMinor, "delivery_cost_minor": o.DeliveryCostMinor,
		"payment_method": o.PaymentMethod, "payment_status": o.PaymentStatus, "paid_at": paidAt,
		"idempotency_key": o.IdempotencyKey,
		"comment":         o.Comment, "desired_at": desiredAt, "estimated_delivery_at": estimated,
		"created_by": o.CreatedBy.String(),
		"created_at": o.CreatedAt, "updated_at": o.UpdatedAt, "items": itemsOut,
	}
}

func deliveryDTO(d domain.OrderDelivery) map[string]any {
	var planned, ws, we, delivered any
	if d.PlannedDeliveryAt != nil {
		planned = *d.PlannedDeliveryAt
	}
	if d.WindowStart != nil {
		ws = *d.WindowStart
	}
	if d.WindowEnd != nil {
		we = *d.WindowEnd
	}
	if d.DeliveredAt != nil {
		delivered = *d.DeliveredAt
	}
	return map[string]any{
		"id": d.ID.String(), "order_id": d.OrderID.String(), "supplier_org_id": d.SupplierOrgID.String(),
		"destination_branch_id": d.DestinationBranchID.String(), "status": d.Status,
		"planned_delivery_at": planned, "window_start": ws, "window_end": we, "delivered_at": delivered,
		"recipient_name": d.RecipientName, "recipient_phone": d.RecipientPhone,
		"comment": d.Comment, "provider": d.Provider, "tracking_code": d.TrackingCode,
		"created_at": d.CreatedAt, "updated_at": d.UpdatedAt,
	}
}

func parseOptionalUUID(s *string) (*uuid.UUID, error) {
	if s == nil || *s == "" {
		return nil, nil
	}
	id, err := uuid.Parse(*s)
	if err != nil {
		return nil, err
	}
	return &id, nil
}
