package httpapi

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerAdminRoutes(mux *http.ServeMux, auth func(http.Handler) http.Handler) {
	admin := func(h http.HandlerFunc) http.Handler {
		return auth(httpx.RequireSystemAdmin(h))
	}
	mux.Handle("GET /v1/admin/masters", admin(a.adminListMasters))
	mux.Handle("GET /v1/admin/masters/stats", admin(a.adminMarketplaceStats))
	mux.Handle("GET /v1/admin/masters/{id}", admin(a.adminGetMaster))
	mux.Handle("POST /v1/admin/masters/{id}/publish", admin(a.adminPublishMaster))
	mux.Handle("POST /v1/admin/masters/{id}/unpublish", admin(a.adminUnpublishMaster))
	mux.Handle("GET /v1/admin/services", admin(a.adminListServices))
	mux.Handle("GET /v1/admin/services/{id}", admin(a.adminGetService))
	mux.Handle("POST /v1/admin/services/{id}/publish", admin(a.adminPublishService))
	mux.Handle("POST /v1/admin/services/{id}/unpublish", admin(a.adminUnpublishService))
	mux.Handle("GET /v1/admin/profession-types", admin(a.adminListProfessionTypes))
	mux.Handle("POST /v1/admin/profession-types", admin(a.adminCreateProfessionType))
	mux.Handle("POST /v1/admin/profession-types/{id}/disable", admin(a.adminDisableProfessionType))
	mux.Handle("POST /v1/admin/profession-types/{id}/enable", admin(a.adminEnableProfessionType))
	mux.Handle("GET /v1/admin/knowledge", admin(a.adminListKnowledge))
	mux.Handle("GET /v1/admin/knowledge/{id}", admin(a.adminGetKnowledge))
	mux.Handle("POST /v1/admin/knowledge/{id}/publish", admin(func(w http.ResponseWriter, r *http.Request) {
		a.adminSetKnowledgeStatus(w, r, "published")
	}))
	mux.Handle("POST /v1/admin/knowledge/{id}/unpublish", admin(func(w http.ResponseWriter, r *http.Request) {
		a.adminSetKnowledgeStatus(w, r, "draft")
	}))
	mux.Handle("POST /v1/admin/knowledge/{id}/archive", admin(func(w http.ResponseWriter, r *http.Request) {
		a.adminSetKnowledgeStatus(w, r, "archived")
	}))
}

func (a *API) adminMarketplaceStats(w http.ResponseWriter, r *http.Request) {
	st, err := a.svc.AdminMarketplaceStats(r.Context())
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"masters_total": st.MastersTotal, "masters_published": st.MastersPublished,
		"services_total": st.ServicesTotal, "articles_total": st.ArticlesTotal,
		"articles_draft": st.ArticlesDraft, "articles_published": st.ArticlesPublished,
	})
}

func (a *API) adminListMasters(w http.ResponseWriter, r *http.Request) {
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
	userID, err := httpx.ParseOptionalUUID(q.Get("user_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid user_id"))
		return
	}
	items, total, err := a.svc.AdminListMasters(r.Context(), store.MasterListFilter{
		Query: q.Get("q"), City: q.Get("city"), OrganizationID: orgID, UserID: userID, Published: published, Limit: limit, Offset: offset,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, m := range items {
		out = append(out, masterDTO(m))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out, "total": total, "limit": limit, "offset": offset})
}

func (a *API) adminGetMaster(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	m, svcs, err := a.svc.AdminGetMaster(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	body := masterDTO(*m)
	sOut := make([]map[string]any, 0, len(svcs))
	for _, item := range svcs {
		sOut = append(sOut, serviceDTO(item))
	}
	body["services"] = sOut
	httpx.JSON(w, http.StatusOK, body)
}

func (a *API) adminPublishMaster(w http.ResponseWriter, r *http.Request) {
	a.adminSetMasterPublished(w, r, true)
}
func (a *API) adminUnpublishMaster(w http.ResponseWriter, r *http.Request) {
	a.adminSetMasterPublished(w, r, false)
}

func (a *API) adminSetMasterPublished(w http.ResponseWriter, r *http.Request, published bool) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	m, err := a.svc.AdminSetMasterPublished(r.Context(), claims.UserID, id, published)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, masterDTO(*m))
}

func (a *API) adminListServices(w http.ResponseWriter, r *http.Request) {
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
	masterID, err := httpx.ParseOptionalUUID(q.Get("master_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid master_id"))
		return
	}
	masterUserID, err := httpx.ParseOptionalUUID(q.Get("master_user_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid master_user_id"))
		return
	}
	items, total, err := a.svc.AdminListServices(r.Context(), store.ServiceListFilter{
		Query: q.Get("q"), Category: q.Get("category"), OrganizationID: orgID, MasterID: masterID, MasterUserID: masterUserID,
		Published: published, Limit: limit, Offset: offset,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, serviceDTO(item))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out, "total": total, "limit": limit, "offset": offset})
}

func (a *API) adminGetService(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	item, err := a.svc.AdminGetService(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, serviceDTO(*item))
}

func (a *API) adminPublishService(w http.ResponseWriter, r *http.Request) {
	a.adminSetServicePublished(w, r, true)
}
func (a *API) adminUnpublishService(w http.ResponseWriter, r *http.Request) {
	a.adminSetServicePublished(w, r, false)
}

func (a *API) adminSetServicePublished(w http.ResponseWriter, r *http.Request, published bool) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	item, err := a.svc.AdminSetServicePublished(r.Context(), claims.UserID, id, published)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, serviceDTO(*item))
}

func (a *API) adminListKnowledge(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, offset := httpx.ParsePage(q.Get("limit"), q.Get("offset"))
	var productIDs []uuid.UUID
	if v := strings.TrimSpace(q.Get("product_id")); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid product_id"))
			return
		}
		productIDs = []uuid.UUID{id}
	}
	var orgIDs []uuid.UUID
	if v := strings.TrimSpace(q.Get("supplier_org_id")); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid supplier_org_id"))
			return
		}
		orgIDs = []uuid.UUID{id}
	}
	res, err := a.svc.ListKnowledge(r.Context(), service.KnowledgeListQuery{
		Query: q.Get("q"), Status: q.Get("status"), AudienceKind: q.Get("audience_kind"),
		ProductIDs: productIDs, SupplierOrgIDs: orgIDs, PublishedOnly: false, Limit: limit, Offset: offset, Sort: "new",
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(res.Items))
	for _, item := range res.Items {
		out = append(out, knowledgeListDTO(item))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out, "total": res.Total, "limit": res.Limit, "offset": res.Offset})
}

func (a *API) adminGetKnowledge(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	item, err := a.svc.AdminGetKnowledge(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, knowledgeDTO(*item))
}

func (a *API) adminSetKnowledgeStatus(w http.ResponseWriter, r *http.Request, status string) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	item, err := a.svc.AdminSetKnowledgeStatus(r.Context(), claims.UserID, id, status)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, knowledgeDTO(*item))
}

func (a *API) adminListProfessionTypes(w http.ResponseWriter, r *http.Request) {
	items, err := a.svc.AdminListProfessionTypes(r.Context())
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, t := range items {
		out = append(out, professionTypeDTO(t))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) adminCreateProfessionType(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	t, err := a.svc.AdminCreateProfessionType(r.Context(), req.Name, req.Slug)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, professionTypeDTO(*t))
}

func (a *API) adminDisableProfessionType(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	if err := a.svc.AdminSetProfessionTypeActive(r.Context(), id, false); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) adminEnableProfessionType(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	if err := a.svc.AdminSetProfessionTypeActive(r.Context(), id, true); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
