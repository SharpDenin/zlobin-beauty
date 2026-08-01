package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

type API struct {
	svc *service.Service
	log *slog.Logger
}

func New(svc *service.Service, log *slog.Logger) *API {
	return &API{svc: svc, log: log}
}

func (a *API) Routes(mux *http.ServeMux, jwtSecret string) {
	auth := httpx.BearerAuth(jwtSecret)
	mux.Handle("POST /v1/organizations", auth(http.HandlerFunc(a.create)))
	mux.Handle("GET /v1/organizations/mine", auth(http.HandlerFunc(a.mine)))
	mux.Handle("POST /v1/organizations/{orgID}/masters", auth(http.HandlerFunc(a.addMaster)))
	mux.Handle("GET /v1/branches/{branchID}", auth(http.HandlerFunc(a.getBranch)))
}

type createReq struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	BranchName  string `json:"branch_name"`
	City        string `json:"city"`
	AddressLine string `json:"address_line"`
	Timezone    string `json:"timezone"`
}

func (a *API) create(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req createReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	res, err := a.svc.Create(r.Context(), service.CreateOrgInput{
		Name: req.Name, Type: req.Type, BranchName: req.BranchName, City: req.City,
		AddressLine: req.AddressLine, Timezone: req.Timezone, CreatedBy: claims.UserID,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{
		"organization": orgDTO(res.Organization),
		"branch":       branchDTO(res.Branch),
	})
}

func (a *API) mine(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgs, branches, mems, err := a.svc.MyOrgs(r.Context(), claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	items := make([]map[string]any, 0, len(orgs))
	for _, o := range orgs {
		bdtos := make([]map[string]any, 0, len(branches[o.ID]))
		for _, b := range branches[o.ID] {
			bdtos = append(bdtos, branchDTO(b))
		}
		roles := make([]string, 0, len(mems[o.ID]))
		for _, m := range mems[o.ID] {
			roles = append(roles, m.Role)
		}
		items = append(items, map[string]any{
			"organization": orgDTO(o),
			"branches":     bdtos,
			"roles":        roles,
		})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

type addMasterReq struct {
	UserID string `json:"user_id"`
}

func (a *API) addMaster(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid org id"))
		return
	}
	var req addMasterReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	masterID, err := uuid.Parse(req.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid user_id"))
		return
	}
	if err := a.svc.AddMasterMembership(r.Context(), orgID, claims.UserID, masterID); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) getBranch(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("branchID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid branch id"))
		return
	}
	b, err := a.svc.GetBranch(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, branchDTO(*b))
}

func orgDTO(o domain.Organization) map[string]any {
	return map[string]any{
		"id": o.ID.String(), "name": o.Name, "type": o.Type, "status": o.Status,
		"created_at": o.CreatedAt, "updated_at": o.UpdatedAt,
	}
}

func branchDTO(b domain.Branch) map[string]any {
	return map[string]any{
		"id": b.ID.String(), "organization_id": b.OrganizationID.String(), "name": b.Name,
		"city": b.City, "address_line": b.AddressLine, "timezone": b.Timezone,
		"cancel_window_hours": b.CancelWindowHours, "auto_confirm": b.AutoConfirm,
	}
}
