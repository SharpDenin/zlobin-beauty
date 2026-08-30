package httpapi

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

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
	mux.Handle("POST /v1/organizations/{orgID}/branches", auth(http.HandlerFunc(a.createBranch)))
	mux.Handle("POST /v1/organizations/{orgID}/masters", auth(http.HandlerFunc(a.addMaster)))
	mux.Handle("GET /v1/organizations/{orgID}/staff", auth(http.HandlerFunc(a.listStaff)))
	mux.Handle("POST /v1/organizations/{orgID}/staff", auth(http.HandlerFunc(a.inviteStaff)))
	mux.Handle("POST /v1/organizations/{orgID}/staff/disable", auth(http.HandlerFunc(a.disableStaff)))
	mux.Handle("PATCH /v1/organizations/{orgID}/contact-policy", auth(http.HandlerFunc(a.setContactPolicy)))
	mux.Handle("GET /v1/organizations/{orgID}/representatives", auth(http.HandlerFunc(a.listReps)))
	mux.Handle("POST /v1/organizations/{orgID}/representatives", auth(http.HandlerFunc(a.createRep)))
	mux.Handle("GET /v1/organizations/{orgID}/representatives/{id}", auth(http.HandlerFunc(a.getRep)))
	mux.Handle("GET /v1/me/representative", auth(http.HandlerFunc(a.myRep)))
	mux.Handle("GET /v1/organizations/{orgID}/tasks", auth(http.HandlerFunc(a.listTasks)))
	mux.Handle("POST /v1/organizations/{orgID}/tasks", auth(http.HandlerFunc(a.createTask)))
	mux.Handle("POST /v1/tasks/{id}/status", auth(http.HandlerFunc(a.taskStatus)))
	mux.Handle("GET /v1/organizations/{orgID}/routes", auth(http.HandlerFunc(a.listRoutes)))
	mux.Handle("POST /v1/organizations/{orgID}/routes/recommend", auth(http.HandlerFunc(a.recommendRoute)))
	mux.Handle("POST /v1/organizations/{orgID}/routes/stops/{id}/status", auth(http.HandlerFunc(a.stopStatus)))
	mux.Handle("GET /v1/branches/{branchID}/readiness", auth(http.HandlerFunc(a.branchReadiness)))
	mux.Handle("PATCH /v1/branches/{branchID}", auth(http.HandlerFunc(a.updateBranch)))
	mux.Handle("POST /v1/branches/{branchID}/photos", auth(http.HandlerFunc(a.addBranchPhoto)))
	mux.Handle("DELETE /v1/branches/{branchID}/photos/{photoID}", auth(http.HandlerFunc(a.deleteBranchPhoto)))
	// Branch metadata (timezone, city, etc.) is read by other services
	// (e.g. booking resolving a master's timezone), so this stays public.
	mux.HandleFunc("GET /v1/branches/pickup", a.listPickupBranches)
	mux.HandleFunc("GET /v1/branches/{branchID}", a.getBranch)
	mux.HandleFunc("GET /v1/branches/{branchID}/photos", a.listBranchPhotos)
	mux.HandleFunc("GET /v1/suppliers", a.listSuppliers)
	mux.HandleFunc("GET /v1/suppliers/{id}", a.getSupplier)
	mux.HandleFunc("GET /v1/internal/memberships/check", a.checkMembership)
	mux.HandleFunc("GET /v1/internal/branches/{branchID}/publication", a.branchPublication)
	mux.HandleFunc("GET /v1/internal/organizations/{orgID}/contact-policy", a.internalContactPolicy)
	mux.HandleFunc("GET /v1/internal/organizations/{orgID}/members", a.internalOrgMembers)
	mux.HandleFunc("GET /v1/internal/organizations/{orgID}", a.internalOrg)
	a.registerAdminRoutes(mux, auth)
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

func (a *API) createBranch(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid org id"))
		return
	}
	var req struct {
		Name        string   `json:"name"`
		City        string   `json:"city"`
		AddressLine string   `json:"address_line"`
		Phone       string   `json:"phone"`
		Timezone    string   `json:"timezone"`
		Latitude    *float64 `json:"latitude"`
		Longitude   *float64 `json:"longitude"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	b, err := a.svc.AddBranch(r.Context(), claims.UserID, orgID, service.AddBranchInput{
		Name: req.Name, City: req.City, AddressLine: req.AddressLine, Phone: req.Phone,
		Timezone: req.Timezone, Latitude: req.Latitude, Longitude: req.Longitude,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, branchDTO(*b))
}

type patchBranchReq struct {
	Name             *string  `json:"name"`
	City             *string  `json:"city"`
	AddressLine      *string  `json:"address_line"`
	Phone            *string  `json:"phone"`
	Timezone         *string  `json:"timezone"`
	Published        *bool    `json:"published"`
	PickupEnabled    *bool    `json:"pickup_enabled"`
	Latitude         *float64 `json:"latitude"`
	Longitude        *float64 `json:"longitude"`
	WorkingHoursNote *string  `json:"working_hours_note"`
	PhotoMediaID     *string  `json:"photo_media_id"`
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
	in := service.UpdateBranchInput{
		ActorID: claims.UserID, BranchID: branchID,
		Name: req.Name, City: req.City, AddressLine: req.AddressLine,
		Phone: req.Phone, Timezone: req.Timezone, Published: req.Published,
		PickupEnabled: req.PickupEnabled, Latitude: req.Latitude, Longitude: req.Longitude,
		WorkingHoursNote: req.WorkingHoursNote,
	}
	if req.PhotoMediaID != nil {
		if *req.PhotoMediaID == "" {
			in.ClearPhotoMedia = true
		} else {
			id, err := uuid.Parse(*req.PhotoMediaID)
			if err != nil {
				httpx.WriteError(w, r, a.log, apperr.Validation("invalid photo_media_id"))
				return
			}
			in.PhotoMediaID = &id
		}
	}
	b, err := a.svc.UpdateBranch(r.Context(), in)
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

func (a *API) listPickupBranches(w http.ResponseWriter, r *http.Request) {
	city := r.URL.Query().Get("city")
	var lat, lng *float64
	if v := strings.TrimSpace(r.URL.Query().Get("lat")); v != "" {
		f, err := strconv.ParseFloat(v, 64)
		if err == nil {
			lat = &f
		}
	}
	if v := strings.TrimSpace(r.URL.Query().Get("lng")); v != "" {
		f, err := strconv.ParseFloat(v, 64)
		if err == nil {
			lng = &f
		}
	}
	if lat != nil || lng != nil || r.URL.Query().Get("nearest") == "1" {
		items, err := a.svc.PickupNearest(r.Context(), city, lat, lng)
		if err != nil {
			httpx.WriteError(w, r, a.log, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
		return
	}
	items, err := a.svc.ListPickupBranches(r.Context(), city)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, b := range items {
		out = append(out, branchDTO(b))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
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
		"masters_see_client_contacts": o.MastersSeeClientContacts,
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
	var photo any
	if b.PhotoMediaID != nil {
		photo = b.PhotoMediaID.String()
	}
	var lat, lng any
	if b.Latitude != nil {
		lat = *b.Latitude
	}
	if b.Longitude != nil {
		lng = *b.Longitude
	}
	return map[string]any{
		"id": b.ID.String(), "organization_id": b.OrganizationID.String(), "name": b.Name,
		"city": b.City, "address_line": b.AddressLine, "phone": b.Phone, "timezone": b.Timezone,
		"cancel_window_hours": b.CancelWindowHours, "auto_confirm": b.AutoConfirm, "published": b.Published,
		"pickup_enabled": b.PickupEnabled, "latitude": lat, "longitude": lng,
		"working_hours_note": b.WorkingHoursNote, "photo_media_id": photo,
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

func (a *API) internalContactPolicy(w http.ResponseWriter, r *http.Request) {
	if a.internalToken == "" || r.Header.Get("X-Internal-Token") != a.internalToken {
		httpx.WriteError(w, r, a.log, apperr.Unauthorized("invalid internal token"))
		return
	}
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid org id"))
		return
	}
	ok, err := a.svc.ContactPolicy(r.Context(), orgID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"masters_see_client_contacts": ok})
}

func (a *API) internalOrg(w http.ResponseWriter, r *http.Request) {
	if a.internalToken == "" || r.Header.Get("X-Internal-Token") != a.internalToken {
		httpx.WriteError(w, r, a.log, apperr.Unauthorized("invalid internal token"))
		return
	}
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid org id"))
		return
	}
	org, err := a.svc.GetOrg(r.Context(), orgID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, orgDTO(*org))
}

func (a *API) internalOrgMembers(w http.ResponseWriter, r *http.Request) {
	if a.internalToken == "" || r.Header.Get("X-Internal-Token") != a.internalToken {
		httpx.WriteError(w, r, a.log, apperr.Unauthorized("invalid internal token"))
		return
	}
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid org id"))
		return
	}
	role := r.URL.Query().Get("role")
	items, err := a.svc.ListOrgMembersInternal(r.Context(), orgID, role)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, m := range items {
		out = append(out, map[string]any{
			"user_id": m.UserID.String(), "role": m.Role, "status": m.Status,
		})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) listStaff(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid org id"))
		return
	}
	items, err := a.svc.ListStaff(r.Context(), orgID, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, m := range items {
		out = append(out, map[string]any{
			"id": m.ID.String(), "user_id": m.UserID.String(), "role": m.Role, "status": m.Status, "created_at": m.CreatedAt,
		})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) inviteStaff(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid org id"))
		return
	}
	var req struct {
		UserID string `json:"user_id"`
		Role   string `json:"role"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	uid, err := uuid.Parse(req.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid user_id"))
		return
	}
	if err := a.svc.InviteStaff(r.Context(), orgID, claims.UserID, uid, req.Role); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) disableStaff(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid org id"))
		return
	}
	var req struct {
		UserID string `json:"user_id"`
		Role   string `json:"role"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	uid, err := uuid.Parse(req.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid user_id"))
		return
	}
	if err := a.svc.DisableStaff(r.Context(), orgID, claims.UserID, uid, req.Role); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) setContactPolicy(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid org id"))
		return
	}
	var req struct {
		MastersSeeClientContacts bool `json:"masters_see_client_contacts"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	org, err := a.svc.SetContactPolicy(r.Context(), orgID, claims.UserID, req.MastersSeeClientContacts)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, orgDTO(*org))
}

func parseUUIDList(raw []string) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(raw))
	for _, s := range raw {
		id, err := uuid.Parse(s)
		if err == nil {
			out = append(out, id)
		}
	}
	return out
}

func repDTO(r domain.SupplierRepresentative) map[string]any {
	return map[string]any{
		"id": r.ID.String(), "user_id": r.UserID.String(),
		"city": r.City, "territory": r.Territory, "active": r.Active,
		"display_name": r.DisplayName, "email": r.Email,
		"created_at": r.CreatedAt,
	}
}

func (a *API) listReps(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid org id"))
		return
	}
	items, err := a.svc.ListRepresentatives(r.Context(), claims.UserID, orgID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	stats, _ := a.svc.ListRepTaskStats(r.Context(), claims.UserID, orgID)
	byRep := map[string]domain.RepTaskStats{}
	for _, st := range stats {
		byRep[st.RepresentativeID.String()] = st
	}
	for _, it := range items {
		row := repDTO(it)
		if st, ok := byRep[it.ID.String()]; ok {
			row["tasks_today"] = st.TasksToday
			row["tasks_done"] = st.TasksDone
			row["tasks_overdue"] = st.TasksOverdue
			row["open_tasks"] = st.OpenTasks
		} else {
			row["tasks_today"] = 0
			row["tasks_done"] = 0
			row["tasks_overdue"] = 0
			row["open_tasks"] = 0
		}
		out = append(out, row)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) createRep(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid org id"))
		return
	}
	var req struct {
		UserID         string   `json:"user_id"`
		City           string   `json:"city"`
		Territory      string   `json:"territory"`
		DisplayName    string   `json:"display_name"`
		Email          string   `json:"email"`
		SalonBranchIDs []string `json:"salon_branch_ids"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	uid, err := uuid.Parse(req.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid user_id"))
		return
	}
	rep, err := a.svc.CreateRepresentative(r.Context(), claims.UserID, orgID, uid, req.City, req.Territory, req.DisplayName, req.Email, parseUUIDList(req.SalonBranchIDs))
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, repDTO(*rep))
}

func (a *API) getRep(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	id, err2 := uuid.Parse(r.PathValue("id"))
	if err != nil || err2 != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	rep, err := a.svc.GetRepresentative(r.Context(), claims.UserID, orgID, id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, repDTO(*rep))
}

func (a *API) myRep(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	rep, err := a.svc.MyRepresentative(r.Context(), claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, repDTO(*rep))
}

func taskDTO(t domain.RepresentativeTask) map[string]any {
	var bid, due any
	if t.BranchID != nil {
		bid = t.BranchID.String()
	}
	if t.DueAt != nil {
		due = *t.DueAt
	}
	return map[string]any{
		"id": t.ID.String(), "title": t.Title, "description": t.Description, "priority": t.Priority,
		"kind": t.Kind, "expected_result": t.ExpectedResult, "planner_category": service.PlannerCategoryForKind(t.Kind),
		"status": t.Status, "result_comment": t.ResultComment, "branch_id": bid, "due_at": due,
		"representative_id": t.RepresentativeID.String(),
	}
}

func (a *API) listTasks(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid org id"))
		return
	}
	var repID *uuid.UUID
	if v := r.URL.Query().Get("representative_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid representative_id"))
			return
		}
		repID = &id
	}
	items, err := a.svc.ListTasks(r.Context(), claims.UserID, orgID, repID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, t := range items {
		out = append(out, taskDTO(t))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) createTask(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid org id"))
		return
	}
	var req struct {
		RepresentativeID string     `json:"representative_id"`
		Title            string     `json:"title"`
		Description      string     `json:"description"`
		Kind             string     `json:"kind"`
		ExpectedResult   string     `json:"expected_result"`
		BranchID         *string    `json:"branch_id"`
		DueAt            *time.Time `json:"due_at"`
		Priority         string     `json:"priority"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	repID, err := uuid.Parse(req.RepresentativeID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid representative_id"))
		return
	}
	var branchID *uuid.UUID
	if req.BranchID != nil && *req.BranchID != "" {
		id, err := uuid.Parse(*req.BranchID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid branch_id"))
			return
		}
		branchID = &id
	}
	t, err := a.svc.CreateTask(r.Context(), claims.UserID, orgID, repID, req.Title, req.Description, req.Kind, req.ExpectedResult, branchID, req.DueAt, req.Priority)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, taskDTO(*t))
}

func (a *API) taskStatus(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Status  string `json:"status"`
		Comment string `json:"comment"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	t, err := a.svc.UpdateTaskStatus(r.Context(), claims.UserID, id, req.Status, req.Comment)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, taskDTO(*t))
}

func stopPublicDTO(st domain.FieldRouteStop) map[string]any {
	return map[string]any{
		"id": st.ID.String(), "kind": st.Kind, "priority": st.Priority,
		"latitude": st.Latitude, "longitude": st.Longitude,
		"expected_duration_min": st.ExpectedDurationMin, "status": st.Status, "sort_order": st.SortOrder,
		"km_from_prev": st.KmFromPrev, "eta_at": st.ETAAt, "deadline_at": st.DeadlineAt,
		"window_start": st.WindowStart, "window_end": st.WindowEnd,
	}
}

func (a *API) listRoutes(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid org id"))
		return
	}
	items, err := a.svc.ListRoutes(r.Context(), claims.UserID, orgID, nil)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, rt := range items {
		stops := make([]map[string]any, 0, len(rt.Stops))
		for _, st := range rt.Stops {
			row := stopPublicDTO(st)
			if st.BranchID != nil {
				if b, err := a.svc.GetBranch(r.Context(), *st.BranchID); err == nil && b != nil {
					row["salon_name"] = b.Name
					row["address_line"] = b.AddressLine
					row["city"] = b.City
				}
			}
			stops = append(stops, row)
		}
		out = append(out, map[string]any{
			"id": rt.ID.String(), "planned_date": rt.PlannedDate, "status": rt.Status,
			"total_km": rt.TotalKm, "total_minutes": rt.TotalMinutes, "provider": rt.Provider,
			"label": "Рекомендованный маршрут", "stops": stops,
		})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) recommendRoute(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid org id"))
		return
	}
	var req struct {
		RepresentativeID string  `json:"representative_id"`
		Date             string  `json:"date"`
		OriginLat        float64 `json:"origin_lat"`
		OriginLng        float64 `json:"origin_lng"`
		Stops            []struct {
			Kind       string     `json:"kind"`
			BranchID   *string    `json:"branch_id"`
			Lat        *float64   `json:"latitude"`
			Lng        *float64   `json:"longitude"`
			Priority   string     `json:"priority"`
			Duration   int        `json:"expected_duration_min"`
			WindowStart *time.Time `json:"window_start"`
			WindowEnd   *time.Time `json:"window_end"`
			DeadlineAt  *time.Time `json:"deadline_at"`
		} `json:"stops"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	repID, err := uuid.Parse(req.RepresentativeID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid representative_id"))
		return
	}
	day, err := time.Parse("2006-01-02", req.Date)
	if err != nil {
		day = time.Now().UTC()
	}
	stops := make([]domain.FieldRouteStop, 0, len(req.Stops))
	for _, st := range req.Stops {
		item := domain.FieldRouteStop{
			Kind: st.Kind, Latitude: st.Lat, Longitude: st.Lng, Priority: st.Priority, ExpectedDurationMin: st.Duration,
			Status: "pending", WindowStart: st.WindowStart, WindowEnd: st.WindowEnd, DeadlineAt: st.DeadlineAt,
		}
		if st.BranchID != nil {
			id, err := uuid.Parse(*st.BranchID)
			if err == nil {
				item.BranchID = &id
			}
		}
		if item.Priority == "" {
			item.Priority = "normal"
		}
		if item.ExpectedDurationMin == 0 {
			item.ExpectedDurationMin = 20
		}
		stops = append(stops, item)
	}
	rt, err := a.svc.RecommendRoute(r.Context(), claims.UserID, orgID, repID, day, req.OriginLat, req.OriginLng, stops)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{
		"id": rt.ID.String(), "status": rt.Status, "total_km": rt.TotalKm, "total_minutes": rt.TotalMinutes,
		"provider": rt.Provider, "label": "Рекомендованный маршрут", "stops": rt.Stops,
	})
}

func (a *API) stopStatus(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.PathValue("orgID"))
	stopID, err2 := uuid.Parse(r.PathValue("id"))
	if err != nil || err2 != nil {
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
	st, err := a.svc.UpdateStopStatus(r.Context(), claims.UserID, orgID, stopID, req.Status)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"id": st.ID.String(), "status": st.Status, "kind": st.Kind})
}
