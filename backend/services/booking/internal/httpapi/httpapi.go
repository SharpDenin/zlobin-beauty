package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/service"
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
	mux.Handle("PUT /v1/me/working-hours", auth(http.HandlerFunc(a.setHours)))
	mux.Handle("GET /v1/me/working-hours", auth(http.HandlerFunc(a.getHours)))
	mux.HandleFunc("GET /v1/masters/{masterUserID}/slots", a.slots)
	mux.Handle("POST /v1/appointments", auth(http.HandlerFunc(a.create)))
	mux.Handle("GET /v1/appointments/mine", auth(http.HandlerFunc(a.mine)))
	mux.Handle("GET /v1/appointments/{id}", auth(http.HandlerFunc(a.get)))
	mux.Handle("GET /v1/appointments/{id}/history", auth(http.HandlerFunc(a.history)))
	mux.Handle("POST /v1/appointments/{id}/confirm", auth(http.HandlerFunc(a.confirm)))
	mux.Handle("POST /v1/appointments/{id}/cancel", auth(http.HandlerFunc(a.cancel)))
	mux.Handle("POST /v1/appointments/{id}/reschedule", auth(http.HandlerFunc(a.reschedule)))
	mux.Handle("POST /v1/appointments/{id}/start", auth(http.HandlerFunc(a.start)))
	mux.Handle("POST /v1/appointments/{id}/complete", auth(http.HandlerFunc(a.complete)))
	mux.Handle("POST /v1/appointments/{id}/no-show", auth(http.HandlerFunc(a.noShow)))
}

func (a *API) setHours(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		Items []service.HoursInput `json:"items"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	hours, err := a.svc.SetWorkingHours(r.Context(), claims.UserID, req.Items)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(hours))
	for _, h := range hours {
		out = append(out, map[string]any{
			"weekday": h.Weekday, "start_minute": h.StartMinute, "end_minute": h.EndMinute,
		})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) getHours(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	hours, err := a.svc.GetWorkingHours(r.Context(), claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(hours))
	for _, h := range hours {
		out = append(out, map[string]any{
			"weekday": h.Weekday, "start_minute": h.StartMinute, "end_minute": h.EndMinute,
		})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) slots(w http.ResponseWriter, r *http.Request) {
	masterUserID, err := uuid.Parse(r.PathValue("masterUserID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid master user id"))
		return
	}
	dayStr := r.URL.Query().Get("date")
	if dayStr == "" {
		httpx.WriteError(w, r, a.log, apperr.Validation("date is required (YYYY-MM-DD)"))
		return
	}
	day, err := time.Parse("2006-01-02", dayStr)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid date"))
		return
	}
	duration := 60
	if v := r.URL.Query().Get("duration_minutes"); v != "" {
		var d int
		if _, err := parseInt(&d, v); err != nil || d <= 0 {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid duration_minutes"))
			return
		}
		duration = d
	}
	tz, err := a.svc.ResolveTimezone(r.Context(), masterUserID, r.URL.Query().Get("timezone"))
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	slots, err := a.svc.FreeSlots(r.Context(), masterUserID, day, duration, tz)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": slots})
}

func parseInt(dst *int, s string) (int, error) {
	var n int
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return 0, apperr.Validation("not an int")
		}
		n = n*10 + int(ch-'0')
	}
	*dst = n
	return n, nil
}

func (a *API) create(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		MasterID  string    `json:"master_id"`
		ServiceID string    `json:"service_id"`
		StartsAt  time.Time `json:"starts_at"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	masterID, err := uuid.Parse(req.MasterID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid master_id"))
		return
	}
	serviceID, err := uuid.Parse(req.ServiceID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid service_id"))
		return
	}
	aapt, err := a.svc.Create(r.Context(), service.CreateInput{
		ClientUserID: claims.UserID, MasterID: masterID, ServiceID: serviceID, StartsAt: req.StartsAt,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, appointmentDTO(*aapt))
}

func (a *API) mine(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	role := r.URL.Query().Get("role")
	if role == "" {
		role = "client"
	}
	items, err := a.svc.ListMine(r.Context(), claims.UserID, role)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, appointmentDTO(item))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) get(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	item, err := a.svc.Get(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, appointmentDTO(*item))
}

func (a *API) confirm(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	item, err := a.svc.Confirm(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, appointmentDTO(*item))
}

func (a *API) cancel(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	item, err := a.svc.Cancel(r.Context(), id, claims.UserID, req.Reason)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, appointmentDTO(*item))
}

func (a *API) reschedule(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		StartsAt time.Time `json:"starts_at"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	item, err := a.svc.Reschedule(r.Context(), id, claims.UserID, req.StartsAt)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, appointmentDTO(*item))
}

func (a *API) start(w http.ResponseWriter, r *http.Request) {
	a.simpleAction(w, r, a.svc.Start)
}

func (a *API) complete(w http.ResponseWriter, r *http.Request) {
	a.simpleAction(w, r, a.svc.Complete)
}

func (a *API) noShow(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	_ = httpx.DecodeJSON(r, &req)
	item, err := a.svc.NoShow(r.Context(), id, claims.UserID, req.Reason)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, appointmentDTO(*item))
}

func (a *API) history(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	items, err := a.svc.History(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, h := range items {
		var from any
		if h.FromStatus != nil {
			from = *h.FromStatus
		}
		out = append(out, map[string]any{
			"from_status": from, "to_status": h.ToStatus, "reason": h.Reason, "created_at": h.CreatedAt,
		})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) simpleAction(w http.ResponseWriter, r *http.Request, fn func(context.Context, uuid.UUID, uuid.UUID) (*domain.Appointment, error)) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	item, err := fn(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, appointmentDTO(*item))
}

func appointmentDTO(a domain.Appointment) map[string]any {
	return map[string]any{
		"id": a.ID.String(), "organization_id": a.OrganizationID.String(), "branch_id": a.BranchID.String(),
		"master_user_id": a.MasterUserID.String(), "client_user_id": a.ClientUserID.String(),
		"service_id": a.ServiceID.String(), "service_name": a.ServiceName,
		"duration_minutes": a.DurationMinutes, "price_minor": a.PriceMinor, "currency": a.Currency,
		"status": a.Status, "cancel_reason": a.CancelReason, "starts_at": a.StartsAt, "ends_at": a.EndsAt,
		"created_at": a.CreatedAt, "updated_at": a.UpdatedAt,
	}
}
