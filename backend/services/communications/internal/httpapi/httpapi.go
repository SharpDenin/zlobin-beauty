package httpapi

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/service"
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
	internal := httpx.InternalAuth(a.internalToken)
	mux.Handle("POST /v1/internal/notifications", internal(http.HandlerFunc(a.createNotification)))
	mux.Handle("GET /v1/internal/reviews/stats", internal(http.HandlerFunc(a.reviewStats)))
	mux.Handle("GET /v1/notifications", auth(http.HandlerFunc(a.listNotifications)))
	mux.Handle("POST /v1/notifications/{id}/read", auth(http.HandlerFunc(a.markRead)))
	mux.Handle("POST /v1/reviews", auth(http.HandlerFunc(a.createReview)))
	mux.Handle("GET /v1/reviews/mine", auth(http.HandlerFunc(a.myReviews)))
	mux.HandleFunc("GET /v1/masters/{masterUserID}/reviews", a.masterReviews)
	a.registerMessengerRoutes(mux, auth)
	mux.Handle("GET /v1/internal/media/{id}/access", internal(http.HandlerFunc(a.mediaAccess)))
}

func (a *API) createNotification(w http.ResponseWriter, r *http.Request) {
	var req struct {
		UserID     string  `json:"user_id"`
		Type       string  `json:"type"`
		Title      string  `json:"title"`
		Body       string  `json:"body"`
		EntityType string  `json:"entity_type"`
		EntityID   *string `json:"entity_id"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	userID, err := uuid.Parse(req.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid user_id"))
		return
	}
	var entityID *uuid.UUID
	if req.EntityID != nil && *req.EntityID != "" {
		id, err := uuid.Parse(*req.EntityID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid entity_id"))
			return
		}
		entityID = &id
	}
	if err := a.svc.CreateNotification(r.Context(), userID, req.Type, req.Title, req.Body, req.EntityType, entityID); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (a *API) reviewStats(w http.ResponseWriter, r *http.Request) {
	var masterIDs []uuid.UUID
	for _, raw := range r.URL.Query()["master_user_id"] {
		id, err := uuid.Parse(raw)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid master_user_id"))
			return
		}
		masterIDs = append(masterIDs, id)
	}
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")
	if fromStr == "" || toStr == "" {
		httpx.WriteError(w, r, a.log, apperr.Validation("from and to are required (RFC3339)"))
		return
	}
	from, err := time.Parse(time.RFC3339, fromStr)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid from timestamp"))
		return
	}
	to, err := time.Parse(time.RFC3339, toStr)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid to timestamp"))
		return
	}
	stats, err := a.svc.ReviewStats(r.Context(), masterIDs, from, to)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"avg": stats.Avg, "count": stats.Count})
}

func (a *API) listNotifications(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	items, err := a.svc.List(r.Context(), claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, n := range items {
		out = append(out, notificationDTO(n))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) markRead(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	if err := a.svc.MarkRead(r.Context(), id, claims.UserID); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) createReview(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		AppointmentID  string `json:"appointment_id"`
		MasterRating   int    `json:"master_rating"`
		ResultRating   int    `json:"result_rating"`
		Comment        string `json:"comment"`
		PublishAllowed bool   `json:"publish_allowed"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	apptID, err := uuid.Parse(req.AppointmentID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid appointment_id"))
		return
	}
	rev, err := a.svc.CreateReview(r.Context(), service.CreateReviewInput{
		AppointmentID: apptID, ActorID: claims.UserID, AuthHeader: r.Header.Get("Authorization"),
		MasterRating: req.MasterRating, ResultRating: req.ResultRating,
		Comment: req.Comment, PublishAllowed: req.PublishAllowed,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, reviewDTO(*rev))
}

func (a *API) myReviews(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	items, err := a.svc.ListMine(r.Context(), claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, rv := range items {
		out = append(out, reviewDTO(rv))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) masterReviews(w http.ResponseWriter, r *http.Request) {
	masterUserID, err := uuid.Parse(r.PathValue("masterUserID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid master user id"))
		return
	}
	items, err := a.svc.ListMasterPublic(r.Context(), masterUserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, rv := range items {
		out = append(out, reviewDTO(rv))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func notificationDTO(n domain.Notification) map[string]any {
	var entityID any
	if n.EntityID != nil {
		entityID = n.EntityID.String()
	}
	var readAt any
	if n.ReadAt != nil {
		readAt = *n.ReadAt
	}
	return map[string]any{
		"id": n.ID.String(), "type": n.Type, "title": n.Title, "body": n.Body,
		"entity_type": n.EntityType, "entity_id": entityID, "read_at": readAt, "created_at": n.CreatedAt,
	}
}

func reviewDTO(r domain.Review) map[string]any {
	return map[string]any{
		"id": r.ID.String(), "appointment_id": r.AppointmentID.String(), "client_user_id": r.ClientUserID.String(),
		"master_user_id": r.MasterUserID.String(), "master_rating": r.MasterRating, "result_rating": r.ResultRating,
		"comment": r.Comment, "publish_allowed": r.PublishAllowed, "hidden": r.Hidden, "created_at": r.CreatedAt,
	}
}
