package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/service"
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
	optional := httpx.OptionalBearerAuth(jwtSecret)
	a.registerOccurrenceRoutes(mux, jwtSecret)
	mux.HandleFunc("GET /v1/profession-types", a.listProfessionTypes)
	mux.HandleFunc("GET /v1/masters", a.search)
	mux.HandleFunc("GET /v1/masters/{id}", a.getMaster)
	mux.HandleFunc("GET /v1/services/popular", a.popularServices)
	mux.Handle("GET /v1/me/master", auth(http.HandlerFunc(a.myMaster)))
	mux.Handle("GET /v1/me/master/readiness", auth(http.HandlerFunc(a.readiness)))
	mux.Handle("PUT /v1/me/master", auth(http.HandlerFunc(a.upsertMaster)))
	mux.Handle("POST /v1/services", auth(http.HandlerFunc(a.createService)))
	mux.Handle("PATCH /v1/services/{id}", auth(http.HandlerFunc(a.updateService)))
	mux.HandleFunc("GET /v1/services/{id}", a.getService)
	mux.HandleFunc("GET /v1/service-categories", a.listServiceCategories)
	mux.Handle("POST /v1/service-categories", auth(http.HandlerFunc(a.createServiceCategory)))
	mux.Handle("PUT /v1/service-categories/{id}", auth(http.HandlerFunc(a.updateServiceCategory)))
	mux.Handle("DELETE /v1/service-categories/{id}", auth(http.HandlerFunc(a.deleteServiceCategory)))
	a.registerKnowledgeRoutes(mux, auth, optional)
	a.registerPortfolioRoutes(mux, auth)
	a.registerPhase4Routes(mux, auth)
}

func (a *API) search(w http.ResponseWriter, r *http.Request) {
	city := r.URL.Query().Get("city")
	q := r.URL.Query().Get("q")
	serviceQ := r.URL.Query().Get("service")
	var priceMin, priceMax *int64
	if v := strings.TrimSpace(r.URL.Query().Get("price_min")); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid price_min"))
			return
		}
		priceMin = &n
	}
	if v := strings.TrimSpace(r.URL.Query().Get("price_max")); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid price_max"))
			return
		}
		priceMax = &n
	}
	var availableOn *time.Time
	if v := strings.TrimSpace(r.URL.Query().Get("available_on")); v != "" {
		day, err := time.Parse("2006-01-02", v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid available_on (YYYY-MM-DD)"))
			return
		}
		availableOn = &day
	}
	includeOtherCities := false
	switch strings.ToLower(strings.TrimSpace(r.URL.Query().Get("include_other_cities"))) {
	case "1", "true", "yes":
		includeOtherCities = true
	}
	var districtID *uuid.UUID
	if v := strings.TrimSpace(r.URL.Query().Get("district_id")); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid district_id"))
			return
		}
		districtID = &id
	}
	hits, err := a.svc.Search(r.Context(), city, q, serviceQ, priceMin, priceMax, availableOn, includeOtherCities, districtID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(hits))
	for _, h := range hits {
		dto := masterDTO(h.Master)
		if h.Onsite != nil {
			dto["onsite_match"] = map[string]any{
				"city": h.Onsite.City, "districts": h.Onsite.Districts,
				"starts_at": h.Onsite.StartsAt, "ends_at": h.Onsite.EndsAt, "badge": h.Onsite.Badge,
			}
		}
		out = append(out, dto)
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
		// Allow resolving by user_id for deep links / booking helpers.
		m2, err2 := a.svc.GetMasterByUserID(r.Context(), id)
		if err2 != nil {
			httpx.WriteError(w, r, a.log, err)
			return
		}
		m3, services2, err3 := a.svc.GetMaster(r.Context(), m2.ID)
		if err3 != nil {
			httpx.WriteError(w, r, a.log, err3)
			return
		}
		m, services = m3, services2
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
	OrganizationID    string    `json:"organization_id"`
	BranchID          string    `json:"branch_id"`
	DisplayName       string    `json:"display_name"`
	Bio               string    `json:"bio"`
	Specializations   []string  `json:"specializations"`
	City              string    `json:"city"`
	ExperienceYears   int       `json:"experience_years"`
	Education         string    `json:"education"`
	PhotoMediaID      string    `json:"photo_media_id"`
	WorkType          string    `json:"work_type"`
	Published         bool      `json:"published"`
	ProfessionTypeIDs *[]string `json:"profession_type_ids"`
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

func (a *API) listProfessionTypes(w http.ResponseWriter, r *http.Request) {
	items, err := a.svc.ListProfessionTypes(r.Context())
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
	var professionTypeIDs *[]uuid.UUID
	if req.ProfessionTypeIDs != nil {
		parsed := make([]uuid.UUID, 0, len(*req.ProfessionTypeIDs))
		for _, raw := range *req.ProfessionTypeIDs {
			id, err := uuid.Parse(strings.TrimSpace(raw))
			if err != nil {
				httpx.WriteError(w, r, a.log, apperr.Validation("invalid profession_type_ids"))
				return
			}
			parsed = append(parsed, id)
		}
		professionTypeIDs = &parsed
	}
	m, err := a.svc.UpsertMaster(r.Context(), service.UpsertMasterInput{
		UserID: claims.UserID, OrganizationID: orgID, BranchID: branchID,
		DisplayName: req.DisplayName, Bio: req.Bio, Specializations: req.Specializations,
		City: req.City, ExperienceYears: req.ExperienceYears, Education: req.Education,
		PhotoMediaID: photoMediaID, WorkType: req.WorkType, Published: req.Published, AccessToken: token,
		ProfessionTypeIDs: professionTypeIDs,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, masterDTO(*m))
}

type createServiceReq struct {
	OrganizationID  string  `json:"organization_id"`
	Name            string  `json:"name"`
	Category        string  `json:"category"`
	Description     string  `json:"description"`
	Notes           string  `json:"notes"`
	PhotoMediaID    *string `json:"photo_media_id"`
	DurationMinutes int     `json:"duration_minutes"`
	PriceMinor      int64   `json:"price_minor"`
	BookingMode     string  `json:"booking_mode"`
	AttachToMe      bool    `json:"attach_to_me"`
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
	photoMediaID, err := parseOptionalUUID(req.PhotoMediaID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid photo_media_id"))
		return
	}
	item, err := a.svc.CreateService(r.Context(), service.CreateServiceInput{
		ActorUserID: claims.UserID, OrganizationID: orgID, Name: req.Name, Category: req.Category,
		Description: req.Description, Notes: req.Notes, PhotoMediaID: photoMediaID,
		DurationMinutes: req.DurationMinutes, PriceMinor: req.PriceMinor, BookingMode: req.BookingMode, AttachToMaster: req.AttachToMe,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, serviceDTO(*item))
}

func (a *API) updateService(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Name            *string         `json:"name"`
		Category        *string         `json:"category"`
		Description     *string         `json:"description"`
		Notes           *string         `json:"notes"`
		PhotoMediaID    json.RawMessage `json:"photo_media_id"`
		DurationMinutes *int            `json:"duration_minutes"`
		PriceMinor      *int64          `json:"price_minor"`
		BookingMode     *string         `json:"booking_mode"`
		Published       *bool           `json:"published"`
		Archived        *bool           `json:"archived"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	in := service.UpdateServiceInput{
		ActorUserID: claims.UserID, ServiceID: id, Name: req.Name, Category: req.Category,
		Description: req.Description, Notes: req.Notes,
		DurationMinutes: req.DurationMinutes, PriceMinor: req.PriceMinor, BookingMode: req.BookingMode,
		Published: req.Published, Archived: req.Archived,
	}
	photoPatch, err := applyPhotoMediaField(req.PhotoMediaID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid photo_media_id"))
		return
	}
	in.ClearPhoto = photoPatch.ClearPhoto
	in.PhotoMediaID = photoPatch.PhotoMediaID
	item, err := a.svc.UpdateService(r.Context(), in)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, serviceDTO(*item))
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
	workType := m.WorkType
	if workType == "" {
		workType = "independent"
	}
	specs := m.Specializations
	if specs == nil {
		specs = []string{}
	}
	types := make([]map[string]any, 0, len(m.ProfessionTypes))
	for _, t := range m.ProfessionTypes {
		types = append(types, professionTypeDTO(t))
	}
	return map[string]any{
		"id": m.ID.String(), "user_id": m.UserID.String(), "organization_id": m.OrganizationID.String(),
		"branch_id": branchID, "display_name": m.DisplayName, "bio": m.Bio, "specializations": specs,
		"city": m.City, "experience_years": m.ExperienceYears, "education": m.Education,
		"photo_media_id": photoMediaID, "work_type": workType,
		"profession_types": types,
		"rating_avg":       m.RatingAvg, "rating_count": m.RatingCount, "published": m.Published,
	}
}

func professionTypeDTO(t domain.ProfessionType) map[string]any {
	var lockedAt any
	if t.LockedAt != nil {
		lockedAt = t.LockedAt.UTC().Format(time.RFC3339)
	}
	return map[string]any{
		"id": t.ID.String(), "slug": t.Slug, "name": t.Name, "is_active": t.IsActive, "locked_at": lockedAt,
	}
}

func serviceDTO(s domain.ServiceItem) map[string]any {
	var photo any
	if s.PhotoMediaID != nil {
		photo = s.PhotoMediaID.String()
	}
	var archivedAt any
	if s.ArchivedAt != nil {
		archivedAt = *s.ArchivedAt
	}
	mode := s.BookingMode
	if mode == "" {
		mode = "flexible"
	}
	return map[string]any{
		"id": s.ID.String(), "organization_id": s.OrganizationID.String(), "name": s.Name, "category": s.Category,
		"description": s.Description, "notes": s.Notes, "photo_media_id": photo,
		"duration_minutes": s.DurationMinutes, "price_minor": s.PriceMinor, "currency": s.Currency,
		"booking_mode":  mode,
		"price_display": formatMoney(s.PriceMinor), "published": s.Published, "archived_at": archivedAt,
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
