package httpapi

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerAdminRoutes(mux *http.ServeMux, auth func(http.Handler) http.Handler) {
	admin := func(h http.HandlerFunc) http.Handler {
		return auth(httpx.RequireSystemAdmin(h))
	}
	mux.Handle("GET /v1/admin/products", admin(a.adminListProducts))
	mux.Handle("GET /v1/admin/products/stats", admin(a.adminCommerceStats))
	mux.Handle("GET /v1/admin/products/{id}", admin(a.adminGetProduct))
	mux.Handle("POST /v1/admin/products/{id}/publish", admin(a.adminPublishProduct))
	mux.Handle("POST /v1/admin/products/{id}/unpublish", admin(a.adminUnpublishProduct))
	mux.Handle("GET /v1/admin/orders", admin(a.adminListOrders))
	mux.Handle("GET /v1/admin/orders/{id}", admin(a.adminGetOrder))
}

func (a *API) adminCommerceStats(w http.ResponseWriter, r *http.Request) {
	st, err := a.svc.AdminCommerceStats(r.Context())
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"products_total": st.ProductsTotal, "products_published": st.ProductsPublished, "orders_total": st.OrdersTotal,
	})
}

func adminProductDTO(p store.AdminProduct) map[string]any {
	dto := productDTO(p.Product)
	dto["available"] = p.Available
	return dto
}

func (a *API) adminListProducts(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, offset := httpx.ParsePage(q.Get("limit"), q.Get("offset"))
	published, err := httpx.ParseOptionalBool(q.Get("published"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid published"))
		return
	}
	orgID, err := httpx.ParseOptionalUUID(q.Get("organization_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid organization_id"))
		return
	}
	catID, err := httpx.ParseOptionalUUID(q.Get("category_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid category_id"))
		return
	}
	items, total, err := a.svc.AdminListProducts(r.Context(), store.ProductListFilter{
		Query: q.Get("q"), OrganizationID: orgID, CategoryID: catID, Audience: q.Get("audience"),
		Published: published, Limit: limit, Offset: offset,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, p := range items {
		out = append(out, adminProductDTO(p))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out, "total": total, "limit": limit, "offset": offset})
}

func (a *API) adminGetProduct(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	item, err := a.svc.AdminGetProduct(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, adminProductDTO(*item))
}

func (a *API) adminPublishProduct(w http.ResponseWriter, r *http.Request) {
	a.adminSetProductPublished(w, r, true)
}
func (a *API) adminUnpublishProduct(w http.ResponseWriter, r *http.Request) {
	a.adminSetProductPublished(w, r, false)
}

func (a *API) adminSetProductPublished(w http.ResponseWriter, r *http.Request, published bool) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	item, err := a.svc.AdminSetProductPublished(r.Context(), claims.UserID, id, published)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, adminProductDTO(*item))
}

func (a *API) adminListOrders(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, offset := httpx.ParsePage(q.Get("limit"), q.Get("offset"))
	userID, err := httpx.ParseOptionalUUID(q.Get("user_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid user_id"))
		return
	}
	orgID, err := httpx.ParseOptionalUUID(q.Get("supplier_org_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid supplier_org_id"))
		return
	}
	items, total, err := a.svc.AdminListOrders(r.Context(), store.OrderListFilter{
		Query: q.Get("q"), Status: q.Get("status"), UserID: userID, SupplierOrgID: orgID, Limit: limit, Offset: offset,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, o := range items {
		out = append(out, clientOrderDTO(o, nil, nil))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out, "total": total, "limit": limit, "offset": offset})
}

func (a *API) adminGetOrder(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	o, items, err := a.svc.AdminGetOrder(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, clientOrderDTO(*o, items, nil))
}
