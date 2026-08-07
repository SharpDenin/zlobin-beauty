package httpapi

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

type API struct {
	svc *service.Service
	log *slog.Logger
}

func New(svc *service.Service, log *slog.Logger) *API { return &API{svc: svc, log: log} }

func (a *API) Routes(mux *http.ServeMux, jwtSecret string) {
	auth := httpx.BearerAuth(jwtSecret)
	mux.HandleFunc("GET /v1/masters", a.search)
	mux.HandleFunc("GET /v1/masters/{id}", a.getMaster)
	mux.HandleFunc("GET /v1/masters/by-user/{userID}", a.getMasterByUser)
	mux.HandleFunc("GET /v1/services/popular", a.popularServices)
	mux.Handle("GET /v1/me/master", auth(http.HandlerFunc(a.myMaster)))
	mux.Handle("GET /v1/me/master/readiness", auth(http.HandlerFunc(a.readiness)))
	mux.Handle("PUT /v1/me/master", auth(http.HandlerFunc(a.upsertMaster)))
	mux.Handle("POST /v1/services", auth(http.HandlerFunc(a.createService)))
	mux.HandleFunc("GET /v1/services/{id}", a.getService)
	mux.HandleFunc("GET /v1/service-categories", a.listServiceCategories)
	mux.Handle("POST /v1/service-categories", auth(http.HandlerFunc(a.createServiceCategory)))
	mux.Handle("PUT /v1/service-categories/{id}", auth(http.HandlerFunc(a.updateServiceCategory)))
	mux.Handle("DELETE /v1/service-categories/{id}", auth(http.HandlerFunc(a.deleteServiceCategory)))
	a.registerPortfolioRoutes(mux, auth)
}

func (a *API) search(w http.ResponseWriter, r *http.Request) {
	city := r.URL.Query().Get("city")
	q := r.URL.Query().Get("q")
	items, err := a.svc.Search(r.Context(), city, q)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, m := range items {
		out = append(out, masterDTO(m))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) getMaster(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	m, services, err := a.svc.GetMaster(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	svcOut := make([]map[string]any, 0, len(services))
	for _, s := range services {
		svcOut = append(svcOut, serviceDTO(s))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"master": masterDTO(*m), "services": svcOut})
}

func (a *API) getMasterByUser(w http.ResponseWriter, r *http.Request) {
	userID, err := uuid.Parse(r.PathValue("userID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid user id"))
		return
	}
	m, err := a.svc.GetMasterByUserID(r.Context(), userID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, masterDTO(*m))
}

func (a *API) myMaster(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	m, services, err := a.svc.GetMyMaster(r.Context(), claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	svcOut := make([]map[string]any, 0, len(services))
	for _, s := range services {
		svcOut = append(svcOut, serviceDTO(s))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"master": masterDTO(*m), "services": svcOut})
}

type upsertMasterReq struct {
	OrganizationID  string   `json:"organization_id"`
	BranchID        string   `json:"branch_id"`
	DisplayName     string   `json:"display_name"`
	Bio             string   `json:"bio"`
	Specializations []string `json:"specializations"`
	City            string   `json:"city"`
	ExperienceYears int      `json:"experience_years"`
	Education       string   `json:"education"`
	PhotoMediaID    string   `json:"photo_media_id"`
	Published       bool     `json:"published"`
}

func (a *API) readiness(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	ready, err := a.svc.MasterReadiness(r.Context(), claims.UserID, token)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, ready)
}

func (a *API) popularServices(w http.ResponseWriter, r *http.Request) {
	items, err := a.svc.PopularServices(r.Context())
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, s := range items {
		out = append(out, serviceDTO(s))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) upsertMaster(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req upsertMasterReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	orgID, err := uuid.Parse(req.OrganizationID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid organization_id"))
		return
	}
	var branchID *uuid.UUID
	if req.BranchID != "" {
		id, err := uuid.Parse(req.BranchID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid branch_id"))
			return
		}
		branchID = &id
	}
	var photoMediaID *uuid.UUID
	if req.PhotoMediaID != "" {
		id, err := uuid.Parse(req.PhotoMediaID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid photo_media_id"))
			return
		}
		photoMediaID = &id
	}
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	m, err := a.svc.UpsertMaster(r.Context(), service.UpsertMasterInput{
		UserID: claims.UserID, OrganizationID: orgID, BranchID: branchID,
		DisplayName: req.DisplayName, Bio: req.Bio, Specializations: req.Specializations,
		City: req.City, ExperienceYears: req.ExperienceYears, Education: req.Education,
		PhotoMediaID: photoMediaID, Published: req.Published, AccessToken: token,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, masterDTO(*m))
}

type createServiceReq struct {
	OrganizationID  string `json:"organization_id"`
	Name            string `json:"name"`
	Category        string `json:"category"`
	DurationMinutes int    `json:"duration_minutes"`
	PriceMinor      int64  `json:"price_minor"`
	AttachToMe      bool   `json:"attach_to_me"`
}

func (a *API) createService(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req createServiceReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	orgID, err := uuid.Parse(req.OrganizationID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid organization_id"))
		return
	}
	item, err := a.svc.CreateService(r.Context(), service.CreateServiceInput{
		ActorUserID: claims.UserID, OrganizationID: orgID, Name: req.Name, Category: req.Category,
		DurationMinutes: req.DurationMinutes, PriceMinor: req.PriceMinor, AttachToMaster: req.AttachToMe,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, serviceDTO(*item))
}

func (a *API) getService(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	item, err := a.svc.GetService(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, serviceDTO(*item))
}

func masterDTO(m domain.MasterProfile) map[string]any {
	var branchID any
	if m.BranchID != nil {
		branchID = m.BranchID.String()
	}
	var photoMediaID any
	if m.PhotoMediaID != nil {
		photoMediaID = m.PhotoMediaID.String()
	}
	specs := m.Specializations
	if specs == nil {
		specs = []string{}
	}
	return map[string]any{
		"id": m.ID.String(), "user_id": m.UserID.String(), "organization_id": m.OrganizationID.String(),
		"branch_id": branchID, "display_name": m.DisplayName, "bio": m.Bio, "specializations": specs,
		"city": m.City, "experience_years": m.ExperienceYears, "education": m.Education,
		"photo_media_id": photoMediaID,
		"rating_avg": m.RatingAvg, "rating_count": m.RatingCount, "published": m.Published,
	}
}

func serviceDTO(s domain.ServiceItem) map[string]any {
	return map[string]any{
		"id": s.ID.String(), "organization_id": s.OrganizationID.String(), "name": s.Name, "category": s.Category,
		"duration_minutes": s.DurationMinutes, "price_minor": s.PriceMinor, "currency": s.Currency,
		"price_display": formatMoney(s.PriceMinor), "published": s.Published,
	}
}

func formatMoney(minor int64) string {
	return strconv.FormatInt(minor/100, 10) + " ₽"
}

func serviceCategoryDTO(c domain.ServiceCategory) map[string]any {
	return map[string]any{
		"id": c.ID.String(), "name": c.Name, "slug": c.Slug,
		"sort_order": c.SortOrder, "created_at": c.CreatedAt,
	}
}

func (a *API) listServiceCategories(w http.ResponseWriter, r *http.Request) {
	items, err := a.svc.ListServiceCategories(r.Context())
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, c := range items {
		out = append(out, serviceCategoryDTO(c))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) createServiceCategory(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	c, err := a.svc.CreateServiceCategory(r.Context(), claims, req.Name, req.Slug)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, serviceCategoryDTO(*c))
}

func (a *API) updateServiceCategory(w http.ResponseWriter, r *http.Request) {
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
	c, err := a.svc.UpdateServiceCategory(r.Context(), claims, id, req.Name, req.Slug)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, serviceCategoryDTO(*c))
}

func (a *API) deleteServiceCategory(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	if err := a.svc.DeleteServiceCategory(r.Context(), claims, id); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
