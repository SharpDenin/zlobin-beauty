package httpapi

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerAdminRoutes(mux *http.ServeMux, auth func(http.Handler) http.Handler) {
	admin := func(h http.HandlerFunc) http.Handler {
		return auth(httpx.RequireSystemAdmin(h))
	}
	mux.Handle("GET /v1/admin/organizations", admin(a.adminListOrgs))
	mux.Handle("GET /v1/admin/organizations/stats", admin(a.adminOrgStats))
	mux.Handle("GET /v1/admin/organizations/{id}", admin(a.adminGetOrg))
	mux.Handle("POST /v1/admin/organizations/{id}/publish", admin(a.adminPublishOrg))
	mux.Handle("POST /v1/admin/organizations/{id}/unpublish", admin(a.adminUnpublishOrg))
	mux.Handle("GET /v1/admin/suppliers", admin(a.adminListSuppliers))
}

func (a *API) adminOrgStats(w http.ResponseWriter, r *http.Request) {
	st, err := a.svc.AdminOrgStats(r.Context())
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"organizations_total": st.Total, "organizations_active": st.Active, "organizations_published": st.Published,
		"salons": st.Salons, "suppliers": st.Suppliers,
	})
}

func (a *API) adminListSuppliers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	q.Set("type", "supplier")
	r.URL.RawQuery = q.Encode()
	a.adminListOrgs(w, r)
}

func (a *API) adminListOrgs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, offset := httpx.ParsePage(q.Get("limit"), q.Get("offset"))
	published, err := httpx.ParseOptionalBool(q.Get("published"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid published"))
		return
	}
	memberID, err := httpx.ParseOptionalUUID(q.Get("member_user_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid member_user_id"))
		return
	}
	items, total, err := a.svc.AdminListOrgs(r.Context(), store.OrgListFilter{
		Query: q.Get("q"), Type: q.Get("type"), Status: q.Get("status"), City: q.Get("city"),
		Published: published, MemberUserID: memberID, Limit: limit, Offset: offset,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		dto := orgDTO(item.Organization)
		dto["city"] = item.City
		out = append(out, dto)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out, "total": total, "limit": limit, "offset": offset})
}

func (a *API) adminGetOrg(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	org, branches, members, err := a.svc.AdminGetOrg(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	body := orgDTO(*org)
	bOut := make([]map[string]any, 0, len(branches))
	for _, b := range branches {
		bOut = append(bOut, branchDTO(b))
	}
	mOut := make([]map[string]any, 0, len(members))
	for _, m := range members {
		mOut = append(mOut, map[string]any{
			"id": m.ID.String(), "user_id": m.UserID.String(), "role": m.Role, "status": m.Status, "created_at": m.CreatedAt,
		})
	}
	body["branches"] = bOut
	body["memberships"] = mOut
	httpx.JSON(w, http.StatusOK, body)
}

func (a *API) adminPublishOrg(w http.ResponseWriter, r *http.Request) {
	a.adminSetOrgPublished(w, r, true)
}

func (a *API) adminUnpublishOrg(w http.ResponseWriter, r *http.Request) {
	a.adminSetOrgPublished(w, r, false)
}

func (a *API) adminSetOrgPublished(w http.ResponseWriter, r *http.Request, published bool) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	org, err := a.svc.AdminSetOrgPublished(r.Context(), claims.UserID, id, published)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, orgDTO(*org))
}
