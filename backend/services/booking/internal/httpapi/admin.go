package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerAdminRoutes(mux *http.ServeMux, auth func(http.Handler) http.Handler) {
	admin := func(h http.HandlerFunc) http.Handler {
		return auth(httpx.RequireSystemAdmin(h))
	}
	mux.Handle("GET /v1/admin/appointments", admin(a.adminListAppointments))
	mux.Handle("GET /v1/admin/appointments/stats", admin(a.adminAppointmentStats))
	mux.Handle("GET /v1/admin/appointments/{id}", admin(a.adminGetAppointment))
	mux.Handle("GET /v1/admin/working-hours", admin(a.adminWorkingHours))
}

func (a *API) adminAppointmentStats(w http.ResponseWriter, r *http.Request) {
	st, err := a.svc.AdminAppointmentStats(r.Context())
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"appointments_total": st.AppointmentsTotal})
}

func parseDayBound(raw string, end bool) (*time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return &t, nil
	}
	day, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return nil, err
	}
	if end {
		next := day.AddDate(0, 0, 1)
		return &next, nil
	}
	return &day, nil
}

func (a *API) adminListAppointments(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, offset := httpx.ParsePage(q.Get("limit"), q.Get("offset"))
	orgID, err := httpx.ParseOptionalUUID(q.Get("organization_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid organization_id"))
		return
	}
	masterID, err := httpx.ParseOptionalUUID(q.Get("master_user_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid master_user_id"))
		return
	}
	clientID, err := httpx.ParseOptionalUUID(q.Get("client_user_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid client_user_id"))
		return
	}
	from, err := parseDayBound(q.Get("from"), false)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid from"))
		return
	}
	to, err := parseDayBound(q.Get("to"), true)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid to"))
		return
	}
	if date := strings.TrimSpace(q.Get("date")); date != "" {
		d, err := parseDayBound(date, false)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid date"))
			return
		}
		from = d
		end, _ := parseDayBound(date, true)
		to = end
	}
	items, total, err := a.svc.AdminListAppointments(r.Context(), store.AppointmentListFilter{
		Query: q.Get("q"), Status: q.Get("status"), OrganizationID: orgID, MasterUserID: masterID, ClientUserID: clientID,
		From: from, To: to, Limit: limit, Offset: offset,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, appointmentDTO(item))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out, "total": total, "limit": limit, "offset": offset})
}

func (a *API) adminGetAppointment(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	item, group, history, err := a.svc.AdminGetAppointment(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	body := appointmentDTO(*item)
	gOut := make([]map[string]any, 0, len(group))
	for _, g := range group {
		gOut = append(gOut, appointmentDTO(g))
	}
	hOut := make([]map[string]any, 0, len(history))
	for _, h := range history {
		var from any
		if h.FromStatus != nil {
			from = *h.FromStatus
		}
		hOut = append(hOut, map[string]any{
			"from_status": from, "to_status": h.ToStatus, "reason": h.Reason, "created_at": h.CreatedAt,
		})
	}
	body["visit"] = gOut
	body["history"] = hOut
	httpx.JSON(w, http.StatusOK, body)
}

func (a *API) adminWorkingHours(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(strings.TrimSpace(r.URL.Query().Get("master_user_id")))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("master_user_id is required"))
		return
	}
	hours, err := a.svc.AdminWorkingHours(r.Context(), id)
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
