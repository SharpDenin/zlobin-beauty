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
	svc           *service.Service
	log           *slog.Logger
	internalToken string
}

func New(svc *service.Service, log *slog.Logger, internalToken string) *API {
	return &API{svc: svc, log: log, internalToken: internalToken}
}

func (a *API) Routes(mux *http.ServeMux, jwtSecret string) {
	auth := httpx.BearerAuth(jwtSecret)
	mux.Handle("POST /v1/organizations", auth(http.HandlerFunc(a.create)))
	mux.Handle("GET /v1/organizations/mine", auth(http.HandlerFunc(a.mine)))
	mux.Handle("GET /v1/organizations/{orgID}/readiness", auth(http.HandlerFunc(a.orgReadiness)))
	mux.Handle("PATCH /v1/organizations/{orgID}", auth(http.HandlerFunc(a.updateOrg)))
	mux.Handle("POST /v1/organizations/{orgID}/masters", auth(http.HandlerFunc(a.addMaster)))
	mux.Handle("GET /v1/branches/{branchID}/readiness", auth(http.HandlerFunc(a.branchReadiness)))
	mux.Handle("PATCH /v1/branches/{branchID}", auth(http.HandlerFunc(a.updateBranch)))
	mux.Handle("POST /v1/branches/{branchID}/photos", auth(http.HandlerFunc(a.addBranchPhoto)))
	mux.Handle("DELETE /v1/branches/{branchID}/photos/{photoID}", auth(http.HandlerFunc(a.deleteBranchPhoto)))
	// Branch metadata (timezone, city, etc.) is read by other services
	// (e.g. booking resolving a master's timezone), so this stays public.
	mux.HandleFunc("GET /v1/branches/{branchID}", a.getBranch)
	mux.HandleFunc("GET /v1/branches/{branchID}/photos", a.listBranchPhotos)
	mux.HandleFunc("GET /v1/suppliers", a.listSuppliers)
	mux.HandleFunc("GET /v1/suppliers/{id}", a.getSupplier)
	mux.HandleFunc("GET /v1/internal/memberships/check", a.checkMembership)
	mux.HandleFunc("GET /v1/internal/branches/{branchID}/publication", a.branchPublication)
}

func (a *API) checkMembership(w http.ResponseWriter, r *http.Request) {
	expected := a.internalToken
	if expected == "" || r.Header.Get("X-Internal-Token") != expected {
		httpx.WriteError(w, r, a.log, apperr.Unauthorized("invalid internal token"))
		return
	}
	orgID, err1 := uuid.Parse(r.URL.Query().Get("organization_id"))
	userID, err2 := uuid.Parse(r.URL.Query().Get("user_id"))
	if err1 != nil || err2 != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("organization_id and user_id are required"))
		return
	}
	roles := r.URL.Query()["role"]
	if len(roles) == 0 {
		roles = []string{"owner", "admin", "master", "staff"}
	}
	ok, err := a.svc.HasActiveMembership(r.Context(), orgID, userID, roles...)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"active": ok})
}

func (a *API) branchPublication(w http.ResponseWriter, r *http.Request) {
	expected := a.internalToken
	if expected == "" || r.Header.Get("X-Internal-Token") != expected {
		httpx.WriteError(w, r, a.log, apperr.Unauthorized("invalid internal token"))
		return
	}
	branchID, err := uuid.Parse(r.PathValue("branchID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid branch id"))
		return
	}
	b, err := a.svc.GetBranch(r.Context(), branchID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	org, err := a.svc.GetOrg(r.Context(), b.OrganizationID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"branch_published": b.Published,
		"org_published":    org.Published,
	})
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

func (a *API) orgReadiness(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid org id"))
		return
	}
	ready, err := a.svc.OrgReadiness(r.Context(), orgID, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, ready)
}

type patchOrgReq struct {
	Name         *string `json:"name"`
	Description  *string `json:"description"`
	Published    *bool   `json:"published"`
	DeliveryNote *string `json:"delivery_note"`
	LogoMediaID  *string `json:"logo_media_id"`
}

func (a *API) updateOrg(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid org id"))
		return
	}
	var req patchOrgReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	in := service.UpdateOrgInput{
		ActorID: claims.UserID, OrgID: orgID,
		Name: req.Name, Description: req.Description, Published: req.Published, DeliveryNote: req.DeliveryNote,
	}
	if req.LogoMediaID != nil {
		if *req.LogoMediaID == "" {
			in.ClearLogo = true
		} else {
			id, err := uuid.Parse(*req.LogoMediaID)
			if err != nil {
				httpx.WriteError(w, r, a.log, apperr.Validation("invalid logo_media_id"))
				return
			}
			in.LogoMediaID = &id
		}
	}
	org, err := a.svc.UpdateOrg(r.Context(), in)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, orgDTO(*org))
}

type patchBranchReq struct {
	Name        *string `json:"name"`
	City        *string `json:"city"`
	AddressLine *string `json:"address_line"`
	Phone       *string `json:"phone"`
	Timezone    *string `json:"timezone"`
	Published   *bool   `json:"published"`
}

func (a *API) updateBranch(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	branchID, err := uuid.Parse(r.PathValue("branchID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid branch id"))
		return
	}
	var req patchBranchReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	b, err := a.svc.UpdateBranch(r.Context(), service.UpdateBranchInput{
		ActorID: claims.UserID, BranchID: branchID,
		Name: req.Name, City: req.City, AddressLine: req.AddressLine,
		Phone: req.Phone, Timezone: req.Timezone, Published: req.Published,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, branchDTO(*b))
}

func (a *API) branchReadiness(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	branchID, err := uuid.Parse(r.PathValue("branchID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid branch id"))
		return
	}
	ready, err := a.svc.BranchReadiness(r.Context(), branchID, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, ready)
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
	var logo any
	if o.LogoMediaID != nil {
		logo = o.LogoMediaID.String()
	}
	return map[string]any{
		"id": o.ID.String(), "name": o.Name, "description": o.Description,
		"type": o.Type, "status": o.Status, "published": o.Published,
		"logo_media_id": logo, "delivery_note": o.DeliveryNote,
		"created_at": o.CreatedAt, "updated_at": o.UpdatedAt,
	}
}

func supplierDTO(s domain.SupplierListItem) map[string]any {
	var logo any
	if s.LogoMediaID != nil {
		logo = s.LogoMediaID.String()
	}
	return map[string]any{
		"id": s.ID.String(), "name": s.Name, "description": s.Description,
		"delivery_note": s.DeliveryNote, "logo_media_id": logo,
		"city": s.City, "product_count": s.ProductCount,
	}
}

func (a *API) listSuppliers(w http.ResponseWriter, r *http.Request) {
	items, err := a.svc.ListSuppliers(r.Context())
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, s := range items {
		out = append(out, supplierDTO(s))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) getSupplier(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid supplier id"))
		return
	}
	item, err := a.svc.GetSupplier(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, supplierDTO(*item))
}

func branchDTO(b domain.Branch) map[string]any {
	return map[string]any{
		"id": b.ID.String(), "organization_id": b.OrganizationID.String(), "name": b.Name,
		"city": b.City, "address_line": b.AddressLine, "phone": b.Phone, "timezone": b.Timezone,
		"cancel_window_hours": b.CancelWindowHours, "auto_confirm": b.AutoConfirm, "published": b.Published,
	}
}

func branchPhotoDTO(p domain.BranchPhoto) map[string]any {
	return map[string]any{
		"id": p.ID.String(), "branch_id": p.BranchID.String(), "media_id": p.MediaID.String(),
		"sort_order": p.SortOrder, "created_at": p.CreatedAt,
	}
}

func (a *API) listBranchPhotos(w http.ResponseWriter, r *http.Request) {
	branchID, err := uuid.Parse(r.PathValue("branchID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid branch id"))
		return
	}
	items, err := a.svc.ListBranchPhotos(r.Context(), branchID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, p := range items {
		out = append(out, branchPhotoDTO(p))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) addBranchPhoto(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	branchID, err := uuid.Parse(r.PathValue("branchID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid branch id"))
		return
	}
	var req struct {
		MediaID   string `json:"media_id"`
		SortOrder int    `json:"sort_order"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	mediaID, err := uuid.Parse(req.MediaID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid media_id"))
		return
	}
	p, err := a.svc.AddBranchPhoto(r.Context(), claims.UserID, branchID, mediaID, req.SortOrder)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, branchPhotoDTO(*p))
}

func (a *API) deleteBranchPhoto(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	photoID, err := uuid.Parse(r.PathValue("photoID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid photo id"))
		return
	}
	if err := a.svc.DeleteBranchPhoto(r.Context(), claims.UserID, photoID); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
