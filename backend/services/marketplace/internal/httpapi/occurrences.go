package httpapi

import (
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerOccurrenceRoutes(mux *http.ServeMux, jwtSecret string) {
	auth := httpx.BearerAuth(jwtSecret)
	optional := httpx.OptionalBearerAuth(jwtSecret)
	internal := httpx.InternalAuth(a.internalToken)

	mux.Handle("POST /v1/services/{id}/occurrences", auth(http.HandlerFunc(a.createOccurrence)))
	mux.Handle("GET /v1/services/{id}/occurrences", optional(http.HandlerFunc(a.listOccurrences)))
	mux.Handle("PATCH /v1/occurrences/{id}", auth(http.HandlerFunc(a.updateOccurrence)))
	mux.Handle("DELETE /v1/occurrences/{id}", auth(http.HandlerFunc(a.cancelOccurrence)))
	mux.Handle("POST /v1/internal/occurrences/{id}/book", internal(http.HandlerFunc(a.internalBookOccurrence)))
	mux.Handle("POST /v1/internal/occurrences/{id}/release", internal(http.HandlerFunc(a.internalReleaseOccurrence)))
}

func occurrenceDTO(o domain.ServiceOccurrence) map[string]any {
	var branchID any
	if o.BranchID != nil {
		branchID = o.BranchID.String()
	}
	var cutoff any
	if o.BookingCutoffAt != nil {
		cutoff = *o.BookingCutoffAt
	}
	remaining := o.Capacity - o.BookedCount
	if remaining < 0 {
		remaining = 0
	}
	return map[string]any{
		"id": o.ID.String(), "service_id": o.ServiceID.String(), "master_user_id": o.MasterUserID.String(),
		"branch_id": branchID, "starts_at": o.StartsAt, "ends_at": o.EndsAt, "timezone": o.Timezone,
		"capacity": o.Capacity, "booked_count": o.BookedCount, "remaining": remaining, "status": o.Status,
		"booking_cutoff_at": cutoff, "title": o.Title, "note": o.Note,
		"created_at": o.CreatedAt, "updated_at": o.UpdatedAt,
	}
}

func (a *API) createOccurrence(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	serviceID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid service id"))
		return
	}
	var req struct {
		BranchID        *string `json:"branch_id"`
		StartsAt        string  `json:"starts_at"`
		EndsAt          string  `json:"ends_at"`
		Timezone        string  `json:"timezone"`
		Capacity        int     `json:"capacity"`
		BookingCutoffAt *string `json:"booking_cutoff_at"`
		Title           string  `json:"title"`
		Note            string  `json:"note"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	starts, err := time.Parse(time.RFC3339, req.StartsAt)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid starts_at (RFC3339)"))
		return
	}
	ends, err := time.Parse(time.RFC3339, req.EndsAt)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid ends_at (RFC3339)"))
		return
	}
	branchID, err := parseOptionalUUID(req.BranchID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid branch_id"))
		return
	}
	var cutoff *time.Time
	if req.BookingCutoffAt != nil && *req.BookingCutoffAt != "" {
		t, err := time.Parse(time.RFC3339, *req.BookingCutoffAt)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid booking_cutoff_at (RFC3339)"))
			return
		}
		cutoff = &t
	}
	item, err := a.svc.CreateOccurrence(r.Context(), service.CreateOccurrenceInput{
		ActorUserID: claims.UserID, ServiceID: serviceID, BranchID: branchID,
		StartsAt: starts, EndsAt: ends, Timezone: req.Timezone, Capacity: req.Capacity,
		BookingCutoffAt: cutoff, Title: req.Title, Note: req.Note,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, occurrenceDTO(*item))
}

func (a *API) listOccurrences(w http.ResponseWriter, r *http.Request) {
	serviceID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid service id"))
		return
	}
	var actorID *uuid.UUID
	if claims, ok := httpx.ClaimsFrom(r.Context()); ok {
		actorID = &claims.UserID
	}
	items, err := a.svc.ListOccurrences(r.Context(), serviceID, actorID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, occurrenceDTO(item))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) updateOccurrence(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		BranchID        *string `json:"branch_id"`
		StartsAt        *string `json:"starts_at"`
		EndsAt          *string `json:"ends_at"`
		Timezone        *string `json:"timezone"`
		Capacity        *int    `json:"capacity"`
		BookingCutoffAt *string `json:"booking_cutoff_at"`
		Title           *string `json:"title"`
		Note            *string `json:"note"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	in := service.UpdateOccurrenceInput{ActorUserID: claims.UserID, OccurrenceID: id, Capacity: req.Capacity, Title: req.Title, Note: req.Note, Timezone: req.Timezone}
	if req.BranchID != nil {
		if *req.BranchID == "" {
			in.ClearBranch = true
		} else {
			branchID, err := uuid.Parse(*req.BranchID)
			if err != nil {
				httpx.WriteError(w, r, a.log, apperr.Validation("invalid branch_id"))
				return
			}
			in.BranchID = &branchID
		}
	}
	if req.StartsAt != nil {
		t, err := time.Parse(time.RFC3339, *req.StartsAt)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid starts_at (RFC3339)"))
			return
		}
		in.StartsAt = &t
	}
	if req.EndsAt != nil {
		t, err := time.Parse(time.RFC3339, *req.EndsAt)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid ends_at (RFC3339)"))
			return
		}
		in.EndsAt = &t
	}
	if req.BookingCutoffAt != nil {
		if *req.BookingCutoffAt == "" {
			in.ClearCutoff = true
		} else {
			t, err := time.Parse(time.RFC3339, *req.BookingCutoffAt)
			if err != nil {
				httpx.WriteError(w, r, a.log, apperr.Validation("invalid booking_cutoff_at (RFC3339)"))
				return
			}
			in.BookingCutoffAt = &t
		}
	}
	item, err := a.svc.UpdateOccurrence(r.Context(), in)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, occurrenceDTO(*item))
}

func (a *API) cancelOccurrence(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	item, err := a.svc.CancelOccurrence(r.Context(), claims.UserID, id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, occurrenceDTO(*item))
}

func (a *API) internalBookOccurrence(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	item, err := a.svc.TryBookOccurrence(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, occurrenceDTO(*item))
}

func (a *API) internalReleaseOccurrence(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	item, err := a.svc.ReleaseOccurrenceSlot(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, occurrenceDTO(*item))
}
