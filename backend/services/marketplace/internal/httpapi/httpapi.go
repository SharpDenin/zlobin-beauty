package httpapi

import (
	"log/slog"
	"net/http"
	"strconv"

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
	mux.Handle("GET /v1/me/master", auth(http.HandlerFunc(a.myMaster)))
	mux.Handle("PUT /v1/me/master", auth(http.HandlerFunc(a.upsertMaster)))
	mux.Handle("POST /v1/services", auth(http.HandlerFunc(a.createService)))
	mux.HandleFunc("GET /v1/services/{id}", a.getService)
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
	Published       bool     `json:"published"`
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
	m, err := a.svc.UpsertMaster(r.Context(), service.UpsertMasterInput{
		UserID: claims.UserID, OrganizationID: orgID, BranchID: branchID,
		DisplayName: req.DisplayName, Bio: req.Bio, Specializations: req.Specializations,
		City: req.City, Published: req.Published,
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
	specs := m.Specializations
	if specs == nil {
		specs = []string{}
	}
	return map[string]any{
		"id": m.ID.String(), "user_id": m.UserID.String(), "organization_id": m.OrganizationID.String(),
		"branch_id": branchID, "display_name": m.DisplayName, "bio": m.Bio, "specializations": specs,
		"city": m.City, "rating_avg": m.RatingAvg, "rating_count": m.RatingCount, "published": m.Published,
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
