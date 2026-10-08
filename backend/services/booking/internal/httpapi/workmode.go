package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerWorkModeRoutes(mux *http.ServeMux, auth func(http.Handler) http.Handler) {
	mux.Handle("GET /v1/geo/cities", auth(http.HandlerFunc(a.listGeoCities)))
	mux.Handle("GET /v1/geo/cities/{id}/districts", auth(http.HandlerFunc(a.listGeoDistricts)))
	mux.Handle("GET /v1/me/work-mode-intervals", auth(http.HandlerFunc(a.listMyWorkModes)))
	mux.Handle("POST /v1/me/work-mode-intervals", auth(http.HandlerFunc(a.createWorkMode)))
	mux.Handle("DELETE /v1/me/work-mode-intervals/{id}", auth(http.HandlerFunc(a.deleteWorkMode)))
	mux.Handle("GET /v1/calendar/work-mode-intervals", auth(http.HandlerFunc(a.calendarWorkModes)))
	mux.Handle("GET /v1/chairs", auth(http.HandlerFunc(a.listChairs)))
	mux.Handle("POST /v1/chairs", auth(http.HandlerFunc(a.createChair)))
	mux.Handle("PATCH /v1/chairs/{id}", auth(http.HandlerFunc(a.patchChair)))
	mux.Handle("GET /v1/chairs/marketplace", auth(http.HandlerFunc(a.marketplaceChairs)))
	mux.Handle("GET /v1/me/usable-chairs", auth(http.HandlerFunc(a.usableChairs)))
	mux.Handle("POST /v1/chairs/{id}/leases", auth(http.HandlerFunc(a.requestLease)))
	mux.Handle("POST /v1/chair-leases/{id}/approve", auth(http.HandlerFunc(a.approveLease)))
	mux.Handle("POST /v1/chair-leases/{id}/reject", auth(http.HandlerFunc(a.rejectLease)))
	mux.Handle("POST /v1/chair-leases/{id}/cancel", auth(http.HandlerFunc(a.cancelLease)))
	mux.Handle("GET /v1/me/chair-leases", auth(http.HandlerFunc(a.myLeases)))
	mux.Handle("GET /v1/chair-leases", auth(http.HandlerFunc(a.orgLeases)))
	mux.HandleFunc("GET /v1/internal/onsite-matches", a.internalOnsiteMatches)
}

func (a *API) listGeoCities(w http.ResponseWriter, r *http.Request) {
	items, err := a.svc.ListGeoCities(r.Context())
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, c := range items {
		out = append(out, map[string]any{"id": c.ID.String(), "name": c.Name, "timezone": c.Timezone})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) listGeoDistricts(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid city id"))
		return
	}
	items, err := a.svc.ListGeoDistricts(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, d := range items {
		out = append(out, map[string]any{"id": d.ID.String(), "city_id": d.CityID.String(), "name": d.Name})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func parseRange(r *http.Request) (time.Time, time.Time, error) {
	fromStr, toStr := r.URL.Query().Get("from"), r.URL.Query().Get("to")
	if fromStr == "" || toStr == "" {
		now := time.Now().UTC()
		from := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, -1)
		return from, from.AddDate(0, 0, 31), nil
	}
	from, err := time.Parse(time.RFC3339, fromStr)
	if err != nil {
		return time.Time{}, time.Time{}, apperr.Validation("from must be RFC3339")
	}
	to, err := time.Parse(time.RFC3339, toStr)
	if err != nil {
		return time.Time{}, time.Time{}, apperr.Validation("to must be RFC3339")
	}
	return from, to, nil
}

func (a *API) listMyWorkModes(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	from, to, err := parseRange(r)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	items, err := a.svc.ListMyWorkModeIntervals(r.Context(), claims.UserID, from, to)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": intervalDTOs(items)})
}

func (a *API) calendarWorkModes(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	from, to, err := parseRange(r)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	var orgID, masterID uuid.UUID
	if v := r.URL.Query().Get("organization_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid organization_id"))
			return
		}
		orgID = id
	}
	if v := r.URL.Query().Get("master_user_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid master_user_id"))
			return
		}
		masterID = id
	}
	items, err := a.svc.CalendarWorkModeIntervals(r.Context(), claims.UserID, orgID, masterID, from, to)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": intervalDTOs(items)})
}

func (a *API) createWorkMode(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		Mode           string    `json:"mode"`
		StartsAt       time.Time `json:"starts_at"`
		EndsAt         time.Time `json:"ends_at"`
		Timezone       string    `json:"timezone"`
		OrganizationID string    `json:"organization_id"`
		BranchID       string    `json:"branch_id"`
		ChairID        string    `json:"chair_id"`
		PercentageRate *float64  `json:"percentage_rate"`
		CityID         string    `json:"city_id"`
		DistrictIDs    []string  `json:"district_ids"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	in := service.WorkModeIntervalInput{
		Mode: req.Mode, StartsAt: req.StartsAt, EndsAt: req.EndsAt, Timezone: req.Timezone, PercentageRate: req.PercentageRate,
	}
	if id, err := optionalUUID(req.OrganizationID); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid organization_id"))
		return
	} else {
		in.OrganizationID = id
	}
	if id, err := optionalUUID(req.BranchID); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid branch_id"))
		return
	} else {
		in.BranchID = id
	}
	if id, err := optionalUUID(req.ChairID); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid chair_id"))
		return
	} else {
		in.ChairID = id
	}
	if id, err := optionalUUID(req.CityID); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid city_id"))
		return
	} else {
		in.CityID = id
	}
	for _, raw := range req.DistrictIDs {
		id, err := uuid.Parse(strings.TrimSpace(raw))
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid district_ids"))
			return
		}
		in.DistrictIDs = append(in.DistrictIDs, id)
	}
	item, err := a.svc.CreateWorkModeInterval(r.Context(), claims.UserID, in)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, intervalDTO(*item))
}

func (a *API) deleteWorkMode(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	if err := a.svc.DeleteWorkModeInterval(r.Context(), claims.UserID, id); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) listChairs(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.URL.Query().Get("organization_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("organization_id is required"))
		return
	}
	items, err := a.svc.ListOrgChairs(r.Context(), claims.UserID, orgID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": chairDTOs(items)})
}

func (a *API) createChair(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		OrganizationID string `json:"organization_id"`
		BranchID       string `json:"branch_id"`
		Name           string `json:"name"`
		Description    string `json:"description"`
		ListedForRent  bool   `json:"listed_for_rent"`
		RentNote       string `json:"rent_note"`
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
	branchID, err := uuid.Parse(req.BranchID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid branch_id"))
		return
	}
	item, err := a.svc.CreateChair(r.Context(), claims.UserID, orgID, branchID, req.Name, req.Description, req.ListedForRent, req.RentNote)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, chairDTO(*item))
}

func (a *API) patchChair(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Name          *string `json:"name"`
		Description   *string `json:"description"`
		Status        *string `json:"status"`
		ListedForRent *bool   `json:"listed_for_rent"`
		RentNote      *string `json:"rent_note"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	item, err := a.svc.UpdateChair(r.Context(), claims.UserID, id, req.Name, req.Description, req.Status, req.ListedForRent, req.RentNote)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, chairDTO(*item))
}

func (a *API) marketplaceChairs(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var actor uuid.UUID
	if claims != nil {
		actor = claims.UserID
	}
	items, err := a.svc.ListMarketplaceChairs(r.Context(), actor)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": chairDTOs(items)})
}

func (a *API) usableChairs(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var orgID uuid.UUID
	if v := r.URL.Query().Get("organization_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid organization_id"))
			return
		}
		orgID = id
	}
	items, err := a.svc.ListUsableChairs(r.Context(), claims.UserID, orgID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": chairDTOs(items)})
}

func (a *API) requestLease(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	chairID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid chair id"))
		return
	}
	var req struct {
		StartsAt time.Time `json:"starts_at"`
		EndsAt   time.Time `json:"ends_at"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	item, err := a.svc.RequestChairLease(r.Context(), claims.UserID, chairID, req.StartsAt, req.EndsAt)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, leaseDTO(*item))
}

func (a *API) approveLease(w http.ResponseWriter, r *http.Request) {
	a.mutateLease(w, r, a.svc.ApproveChairLease)
}

func (a *API) rejectLease(w http.ResponseWriter, r *http.Request) {
	a.mutateLease(w, r, a.svc.RejectChairLease)
}

func (a *API) cancelLease(w http.ResponseWriter, r *http.Request) {
	a.mutateLease(w, r, a.svc.CancelChairLease)
}

func (a *API) mutateLease(w http.ResponseWriter, r *http.Request, fn func(ctx context.Context, actor, id uuid.UUID) (*domain.ChairLease, error)) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	item, err := fn(r.Context(), claims.UserID, id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, leaseDTO(*item))
}

func (a *API) myLeases(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	items, err := a.svc.ListMyLeases(r.Context(), claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": leaseDTOs(items)})
}

func (a *API) orgLeases(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(r.URL.Query().Get("organization_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("organization_id is required"))
		return
	}
	items, err := a.svc.ListOrgLeases(r.Context(), claims.UserID, orgID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": leaseDTOs(items)})
}

func (a *API) internalOnsiteMatches(w http.ResponseWriter, r *http.Request) {
	if a.internalToken == "" || r.Header.Get("X-Internal-Token") != a.internalToken {
		httpx.WriteError(w, r, a.log, apperr.Unauthorized("invalid internal token"))
		return
	}
	city := strings.TrimSpace(r.URL.Query().Get("city"))
	districtID, err := uuid.Parse(r.URL.Query().Get("district_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("district_id is required"))
		return
	}
	day, err := time.Parse("2006-01-02", r.URL.Query().Get("date"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("date is required (YYYY-MM-DD)"))
		return
	}
	var masters []uuid.UUID
	for _, raw := range r.URL.Query()["master_user_id"] {
		id, err := uuid.Parse(raw)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid master_user_id"))
			return
		}
		masters = append(masters, id)
	}
	items, err := a.svc.InternalOnsiteMatches(r.Context(), city, districtID, day, masters)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, m := range items {
		out = append(out, map[string]any{
			"master_user_id": m.MasterUserID.String(), "starts_at": m.StartsAt, "ends_at": m.EndsAt,
			"timezone": m.Timezone, "city": m.City, "districts": m.Districts, "interval_id": m.IntervalID.String(),
			"badge": "Выезд в вашем районе",
		})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func optionalUUID(raw string) (*uuid.UUID, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func intervalDTOs(items []domain.WorkModeInterval) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		out = append(out, intervalDTO(it))
	}
	return out
}

func intervalDTO(it domain.WorkModeInterval) map[string]any {
	districts := make([]map[string]any, 0, len(it.Districts))
	names := make([]string, 0, len(it.Districts))
	for _, d := range it.Districts {
		districts = append(districts, map[string]any{"id": d.ID.String(), "city_id": d.CityID.String(), "name": d.Name})
		names = append(names, d.Name)
	}
	loc := ""
	switch it.Mode {
	case domain.WorkModeChair:
		if it.Chair != nil {
			loc = it.Chair.Name
		}
	case domain.WorkModeOnsite:
		city := ""
		if it.City != nil {
			city = it.City.Name
		}
		loc = strings.TrimSpace(city + " · " + strings.Join(names, ", "))
	case domain.WorkModePercentage:
		if it.PercentageRate != nil {
			loc = "На процентах"
		}
	}
	return map[string]any{
		"id": it.ID.String(), "master_user_id": it.MasterUserID.String(), "mode": it.Mode,
		"mode_label": domain.WorkModeLabel(it.Mode), "starts_at": it.StartsAt, "ends_at": it.EndsAt,
		"timezone": it.Timezone, "organization_id": uuidOrNil(it.OrganizationID), "branch_id": uuidOrNil(it.BranchID),
		"chair_id": uuidOrNil(it.ChairID), "percentage_rate": it.PercentageRate, "city_id": uuidOrNil(it.CityID),
		"districts": districts, "chair": chairPtrDTO(it.Chair), "city": cityPtrDTO(it.City),
		"location_label": loc, "created_at": it.CreatedAt, "updated_at": it.UpdatedAt,
	}
}

func chairDTOs(items []domain.SalonChair) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, c := range items {
		out = append(out, chairDTO(c))
	}
	return out
}

func chairDTO(c domain.SalonChair) map[string]any {
	return map[string]any{
		"id": c.ID.String(), "organization_id": c.OrganizationID.String(), "branch_id": c.BranchID.String(),
		"name": c.Name, "description": c.Description, "status": c.Status,
		"listed_for_rent": c.ListedForRent, "rent_note": c.RentNote,
		"created_at": c.CreatedAt, "updated_at": c.UpdatedAt,
	}
}

func chairPtrDTO(c *domain.SalonChair) any {
	if c == nil {
		return nil
	}
	return chairDTO(*c)
}

func cityPtrDTO(c *domain.GeoCity) any {
	if c == nil {
		return nil
	}
	return map[string]any{"id": c.ID.String(), "name": c.Name, "timezone": c.Timezone}
}

func leaseDTOs(items []domain.ChairLease) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, l := range items {
		out = append(out, leaseDTO(l))
	}
	return out
}

func leaseDTO(l domain.ChairLease) map[string]any {
	return map[string]any{
		"id": l.ID.String(), "chair_id": l.ChairID.String(), "organization_id": l.OrganizationID.String(),
		"renter_user_id": l.RenterUserID.String(), "starts_at": l.StartsAt, "ends_at": l.EndsAt,
		"status": l.Status, "created_at": l.CreatedAt, "updated_at": l.UpdatedAt, "chair": chairPtrDTO(l.Chair),
	}
}
