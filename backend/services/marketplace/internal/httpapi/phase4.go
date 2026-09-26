package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerPhase4Routes(mux *http.ServeMux, auth func(http.Handler) http.Handler) {
	internal := httpx.InternalAuth(a.internalToken)
	mux.Handle("GET /v1/masterclasses", auth(http.HandlerFunc(a.listMasterclasses)))
	mux.Handle("POST /v1/masterclasses", auth(http.HandlerFunc(a.createMasterclass)))
	mux.Handle("GET /v1/masterclasses/{id}", auth(http.HandlerFunc(a.getMasterclass)))
	mux.Handle("PATCH /v1/masterclasses/{id}", auth(http.HandlerFunc(a.patchMasterclass)))
	mux.Handle("POST /v1/masterclasses/{id}/publish", auth(http.HandlerFunc(a.publishMasterclass)))
	mux.Handle("POST /v1/masterclasses/{id}/register", auth(http.HandlerFunc(a.registerMasterclass)))
	mux.Handle("GET /v1/masterclasses/{id}/registrations", auth(http.HandlerFunc(a.listMCRegistrations)))
	mux.Handle("GET /v1/masterclasses/{id}/matches", auth(http.HandlerFunc(a.masterclassMatches)))
	mux.Handle("GET /v1/masterclass-interests", auth(http.HandlerFunc(a.listInterests)))
	mux.Handle("POST /v1/masterclass-interests", auth(http.HandlerFunc(a.createInterest)))
	mux.Handle("POST /v1/masterclass-registrations/{id}/cancel", auth(http.HandlerFunc(a.cancelRegistration)))

	mux.Handle("GET /v1/model-requests", auth(http.HandlerFunc(a.listModelRequests)))
	mux.Handle("POST /v1/model-requests", auth(http.HandlerFunc(a.createModelRequest)))
	mux.Handle("GET /v1/model-requests/{id}", auth(http.HandlerFunc(a.getModelRequest)))
	mux.Handle("PATCH /v1/model-requests/{id}", auth(http.HandlerFunc(a.patchModelRequest)))
	mux.Handle("POST /v1/model-requests/{id}/publish", auth(http.HandlerFunc(a.publishModelRequest)))
	mux.Handle("POST /v1/model-requests/{id}/respond", auth(http.HandlerFunc(a.respondModelRequest)))
	mux.Handle("GET /v1/model-requests/{id}/responses", auth(http.HandlerFunc(a.listModelResponses)))
	mux.Handle("POST /v1/model-responses/{id}/accept", auth(http.HandlerFunc(a.acceptModelResponse)))
	mux.Handle("POST /v1/model-responses/{id}/cancel", auth(http.HandlerFunc(a.cancelModelResponse)))

	mux.Handle("GET /v1/internal/masters/by-user/{userID}", internal(http.HandlerFunc(a.internalMasterByUser)))
	mux.Handle("GET /v1/internal/masterclasses/{id}/access", internal(http.HandlerFunc(a.internalMasterclassAccess)))
	mux.Handle("GET /v1/internal/model-requests/{id}/access", internal(http.HandlerFunc(a.internalModelAccess)))
}

func (a *API) listMasterclasses(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	limit, offset := parseLimitOffset(r)
	mine := r.URL.Query().Get("mine") == "1" || r.URL.Query().Get("mine") == "true"
	items, err := a.svc.ListMasterclasses(r.Context(), claims.UserID, mine, limit, offset)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, e := range items {
		out = append(out, masterclassDTO(e))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out, "limit": limit, "offset": offset})
}

func (a *API) createMasterclass(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	in, err := decodeMasterclass(r)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	in.ActorID = claims.UserID
	e, err := a.svc.CreateMasterclass(r.Context(), in)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, masterclassDTO(*e))
}

func (a *API) getMasterclass(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	e, err := a.svc.GetMasterclass(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, masterclassDTO(*e))
}

func (a *API) patchMasterclass(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	in, err := decodeMasterclass(r)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	in.ActorID = claims.UserID
	in.ID = &id
	e, err := a.svc.PatchMasterclass(r.Context(), in)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, masterclassDTO(*e))
}

func (a *API) publishMasterclass(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	e, err := a.svc.PublishMasterclass(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, masterclassDTO(*e))
}

func (a *API) registerMasterclass(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	reg, err := a.svc.RegisterMasterclass(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, registrationDTO(*reg))
}

func (a *API) listMCRegistrations(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	items, err := a.svc.ListRegistrations(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		out = append(out, registrationDTO(it))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) masterclassMatches(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	items, err := a.svc.MatchingInterests(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		out = append(out, interestDTO(it))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) listInterests(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	items, err := a.svc.ListInterests(r.Context(), claims.UserID, false)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		out = append(out, interestDTO(it))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) createInterest(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		Category     string `json:"category"`
		City         string `json:"city"`
		LocationNote string `json:"location_note"`
		DateFrom     string `json:"date_from"`
		DateTo       string `json:"date_to"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	from, err1 := time.Parse("2006-01-02", req.DateFrom)
	to, err2 := time.Parse("2006-01-02", req.DateTo)
	if err1 != nil || err2 != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("date_from and date_to must be YYYY-MM-DD"))
		return
	}
	item, err := a.svc.CreateInterest(r.Context(), claims.UserID, req.Category, req.City, req.LocationNote, from, to)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, interestDTO(*item))
}

func (a *API) cancelRegistration(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	if err := a.svc.CancelRegistration(r.Context(), id, claims.UserID); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) listModelRequests(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	limit, offset := parseLimitOffset(r)
	mine := r.URL.Query().Get("mine") == "1" || r.URL.Query().Get("mine") == "true"
	items, err := a.svc.ListModelRequests(r.Context(), claims.UserID, mine, limit, offset)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, e := range items {
		out = append(out, modelRequestDTO(e))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out, "limit": limit, "offset": offset})
}

func (a *API) createModelRequest(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	in, err := decodeModelRequest(r)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	in.ActorID = claims.UserID
	e, err := a.svc.CreateModelRequest(r.Context(), in)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, modelRequestDTO(*e))
}

func (a *API) getModelRequest(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	e, err := a.svc.GetModelRequest(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, modelRequestDTO(*e))
}

func (a *API) patchModelRequest(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	in, err := decodeModelRequest(r)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	in.ActorID = claims.UserID
	in.ID = &id
	e, err := a.svc.PatchModelRequest(r.Context(), in)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, modelRequestDTO(*e))
}

func (a *API) publishModelRequest(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	e, err := a.svc.PublishModelRequest(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, modelRequestDTO(*e))
}

func (a *API) respondModelRequest(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	resp, err := a.svc.RespondModelRequest(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, modelResponseDTO(*resp))
}

func (a *API) listModelResponses(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	items, err := a.svc.ListModelResponses(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		out = append(out, modelResponseDTO(it))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) acceptModelResponse(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	req, err := a.svc.AcceptModelResponse(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, modelRequestDTO(*req))
}

func (a *API) cancelModelResponse(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	if err := a.svc.CancelModelResponse(r.Context(), id, claims.UserID); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) internalMasterByUser(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("userID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid user id"))
		return
	}
	m, err := a.svc.GetMasterByUserID(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"id": m.ID.String(), "user_id": m.UserID.String(), "published": m.Published, "display_name": m.DisplayName,
	})
}

func (a *API) internalMasterclassAccess(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	actor, err1 := uuid.Parse(r.URL.Query().Get("actor_id"))
	peer, err2 := uuid.Parse(r.URL.Query().Get("peer_id"))
	if err1 != nil || err2 != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("actor_id and peer_id are required"))
		return
	}
	instructor, allowed, err := a.svc.MasterclassAccess(r.Context(), id, actor, peer)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"instructor_user_id": instructor.String(), "allowed": allowed})
}

func (a *API) internalModelAccess(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	actor, err1 := uuid.Parse(r.URL.Query().Get("actor_id"))
	peer, err2 := uuid.Parse(r.URL.Query().Get("peer_id"))
	if err1 != nil || err2 != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("actor_id and peer_id are required"))
		return
	}
	allowed, err := a.svc.ModelRequestAccess(r.Context(), id, actor, peer)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"allowed": allowed})
}

func decodeMasterclass(r *http.Request) (service.UpsertMasterclassInput, error) {
	var req struct {
		Title        string `json:"title"`
		Description  string `json:"description"`
		Category     string `json:"category"`
		City         string `json:"city"`
		LocationNote string `json:"location_note"`
		StartsAt     string `json:"starts_at"`
		EndsAt       string `json:"ends_at"`
		Timezone     string `json:"timezone"`
		Capacity     int    `json:"capacity"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return service.UpsertMasterclassInput{}, apperr.Validation("invalid json body")
	}
	starts, err1 := time.Parse(time.RFC3339, req.StartsAt)
	ends, err2 := time.Parse(time.RFC3339, req.EndsAt)
	if err1 != nil || err2 != nil {
		return service.UpsertMasterclassInput{}, apperr.Validation("starts_at and ends_at must be RFC3339")
	}
	return service.UpsertMasterclassInput{
		Title: req.Title, Description: req.Description, Category: req.Category, City: req.City,
		LocationNote: req.LocationNote, StartsAt: starts, EndsAt: ends, Timezone: req.Timezone, Capacity: req.Capacity,
	}, nil
}

func decodeModelRequest(r *http.Request) (service.UpsertModelRequestInput, error) {
	var req struct {
		Category     string `json:"category"`
		Title        string `json:"title"`
		Description  string `json:"description"`
		City         string `json:"city"`
		LocationNote string `json:"location_note"`
		StartsAt     string `json:"starts_at"`
		EndsAt       string `json:"ends_at"`
		Timezone     string `json:"timezone"`
		Capacity     int    `json:"capacity"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return service.UpsertModelRequestInput{}, apperr.Validation("invalid json body")
	}
	starts, err1 := time.Parse(time.RFC3339, req.StartsAt)
	ends, err2 := time.Parse(time.RFC3339, req.EndsAt)
	if err1 != nil || err2 != nil {
		return service.UpsertModelRequestInput{}, apperr.Validation("starts_at and ends_at must be RFC3339")
	}
	return service.UpsertModelRequestInput{
		Category: req.Category, Title: req.Title, Description: req.Description, City: req.City,
		LocationNote: req.LocationNote, StartsAt: starts, EndsAt: ends, Timezone: req.Timezone, Capacity: req.Capacity,
	}, nil
}

func parseLimitOffset(r *http.Request) (int, int) {
	limit, offset := 50, 0
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil {
		limit = n
	}
	if n, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil {
		offset = n
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func masterclassDTO(e domain.MasterclassEvent) map[string]any {
	seats := e.Capacity - e.RegisteredCount
	if seats < 0 {
		seats = 0
	}
	return map[string]any{
		"id": e.ID.String(), "instructor_user_id": e.InstructorUserID.String(), "instructor_name": e.InstructorName,
		"title": e.Title, "description": e.Description, "category": e.Category, "city": e.City,
		"location_note": e.LocationNote, "starts_at": e.StartsAt, "ends_at": e.EndsAt, "timezone": e.Timezone,
		"capacity": e.Capacity, "registered_count": e.RegisteredCount, "available_seats": seats,
		"status": e.Status, "relevant": e.Relevant, "match_score": e.MatchScore,
		"created_at": e.CreatedAt, "updated_at": e.UpdatedAt,
	}
}

func interestDTO(i domain.MasterclassInterest) map[string]any {
	return map[string]any{
		"id": i.ID.String(), "master_user_id": i.MasterUserID.String(), "category": i.Category, "city": i.City,
		"date_from": i.DateFrom.Format("2006-01-02"), "date_to": i.DateTo.Format("2006-01-02"),
		"location_note": i.LocationNote, "status": i.Status, "match_score": i.MatchScore, "created_at": i.CreatedAt,
	}
}

func registrationDTO(r domain.MasterclassRegistration) map[string]any {
	return map[string]any{
		"id": r.ID.String(), "event_id": r.EventID.String(), "master_user_id": r.MasterUserID.String(),
		"status": r.Status, "created_at": r.CreatedAt, "updated_at": r.UpdatedAt,
	}
}

func modelRequestDTO(e domain.ModelRequest) map[string]any {
	slots := e.Capacity - e.AcceptedCount
	if slots < 0 {
		slots = 0
	}
	var mine any
	if e.MyResponse != nil {
		mine = modelResponseDTO(*e.MyResponse)
	}
	return map[string]any{
		"id": e.ID.String(), "master_user_id": e.MasterUserID.String(), "master_name": e.MasterName,
		"category": e.Category, "title": e.Title, "description": e.Description, "city": e.City,
		"location_note": e.LocationNote, "starts_at": e.StartsAt, "ends_at": e.EndsAt, "timezone": e.Timezone,
		"capacity": e.Capacity, "accepted_count": e.AcceptedCount, "available_slots": slots,
		"status": e.Status, "relevant": e.Relevant, "match_score": e.MatchScore, "my_response": mine,
		"created_at": e.CreatedAt, "updated_at": e.UpdatedAt,
	}
}

func modelResponseDTO(r domain.ModelResponse) map[string]any {
	return map[string]any{
		"id": r.ID.String(), "request_id": r.RequestID.String(), "client_user_id": r.ClientUserID.String(),
		"status": r.Status, "created_at": r.CreatedAt, "updated_at": r.UpdatedAt,
	}
}
