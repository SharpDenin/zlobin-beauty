package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/service"
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
	mux.HandleFunc("POST /v1/internal/visits/from-appointment", a.fromAppointment)
	mux.HandleFunc("POST /v1/internal/formulas", a.internalFormula)
	// Literal prefixes avoid ServeMux conflicts between "{id}/visits" and "by-appointment/{id}".
	mux.Handle("GET /v1/clients/mine", auth(http.HandlerFunc(a.mine)))
	mux.Handle("GET /v1/clients/appointment/{appointmentID}", auth(http.HandlerFunc(a.byAppointment)))
	mux.Handle("GET /v1/clients/id/{id}", auth(http.HandlerFunc(a.getCard)))
	mux.Handle("GET /v1/clients/id/{id}/visits", auth(http.HandlerFunc(a.visits)))
	mux.Handle("POST /v1/clients/id/{id}/notes", auth(http.HandlerFunc(a.addNote)))
	mux.Handle("POST /v1/clients/id/{id}/formulas", auth(http.HandlerFunc(a.addFormula)))
	mux.Handle("GET /v1/clients/id/{id}/formulas", auth(http.HandlerFunc(a.formulas)))
	mux.Handle("POST /v1/clients/id/{id}/consents", auth(http.HandlerFunc(a.consent)))
	mux.Handle("GET /v1/clients/id/{id}/disputes", auth(http.HandlerFunc(a.listDisputes)))
	mux.Handle("POST /v1/clients/id/{id}/disputes", auth(http.HandlerFunc(a.createDispute)))
	mux.Handle("POST /v1/clients/disputes/{disputeID}/resolve", auth(http.HandlerFunc(a.resolveDispute)))
	// Aliases under /v1/client-cards for the same handlers.
	mux.Handle("GET /v1/client-cards/mine", auth(http.HandlerFunc(a.mine)))
	mux.Handle("GET /v1/client-cards/appointment/{appointmentID}", auth(http.HandlerFunc(a.byAppointment)))
	mux.Handle("GET /v1/client-cards/id/{id}", auth(http.HandlerFunc(a.getCard)))
	mux.Handle("GET /v1/client-cards/id/{id}/visits", auth(http.HandlerFunc(a.visits)))
	mux.Handle("POST /v1/client-cards/id/{id}/notes", auth(http.HandlerFunc(a.addNote)))
	mux.Handle("POST /v1/client-cards/id/{id}/formulas", auth(http.HandlerFunc(a.addFormula)))
	mux.Handle("GET /v1/client-cards/id/{id}/formulas", auth(http.HandlerFunc(a.formulas)))
	mux.Handle("POST /v1/client-cards/id/{id}/consents", auth(http.HandlerFunc(a.consent)))
	mux.Handle("GET /v1/client-cards/id/{id}/disputes", auth(http.HandlerFunc(a.listDisputes)))
	mux.Handle("POST /v1/client-cards/id/{id}/disputes", auth(http.HandlerFunc(a.createDispute)))
}

func (a *API) fromAppointment(w http.ResponseWriter, r *http.Request) {
	if err := a.svc.CheckInternal(r.Header.Get("X-Internal-Token")); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	var req struct {
		AppointmentID  string    `json:"appointment_id"`
		OrganizationID string    `json:"organization_id"`
		MasterUserID   string    `json:"master_user_id"`
		ClientUserID   string    `json:"client_user_id"`
		ServiceName    string    `json:"service_name"`
		PriceMinor     int64     `json:"price_minor"`
		Currency       string    `json:"currency"`
		StartedAt      time.Time `json:"started_at"`
		CompletedAt    time.Time `json:"completed_at"`
		DisplayName    string    `json:"display_name"`
		Phone          *string   `json:"phone"`
		Email          *string   `json:"email"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	apptID, err1 := uuid.Parse(req.AppointmentID)
	orgID, err2 := uuid.Parse(req.OrganizationID)
	masterID, err3 := uuid.Parse(req.MasterUserID)
	clientID, err4 := uuid.Parse(req.ClientUserID)
	if err1 != nil || err2 != nil || err3 != nil || err4 != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid ids"))
		return
	}
	card, err := a.svc.FromAppointment(r.Context(), service.FromAppointmentInput{
		AppointmentID: apptID, OrganizationID: orgID, MasterUserID: masterID, ClientUserID: clientID,
		ServiceName: req.ServiceName, PriceMinor: req.PriceMinor, Currency: req.Currency,
		StartedAt: req.StartedAt, CompletedAt: req.CompletedAt, DisplayName: req.DisplayName,
		Phone: req.Phone, Email: req.Email,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, cardDTO(*card))
}

func (a *API) mine(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var orgID *uuid.UUID
	if v := r.URL.Query().Get("organization_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid organization_id"))
			return
		}
		orgID = &id
	}
	segment := r.URL.Query().Get("segment")
	items, err := a.svc.ListMine(r.Context(), claims.UserID, orgID, segment)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, c := range items {
		a.svc.ApplyContactPolicy(r.Context(), claims.UserID, claims.Roles, &c.Card)
		out = append(out, cardListDTO(c))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) byAppointment(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("appointmentID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	card, err := a.svc.ByAppointment(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	a.svc.ApplyContactPolicy(r.Context(), claims.UserID, claims.Roles, card)
	httpx.JSON(w, http.StatusOK, cardDTO(*card))
}

func (a *API) getCard(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	card, err := a.svc.GetCard(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	a.svc.ApplyContactPolicy(r.Context(), claims.UserID, claims.Roles, card)
	httpx.JSON(w, http.StatusOK, cardDTO(*card))
}

func (a *API) visits(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	items, err := a.svc.ListVisits(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, v := range items {
		out = append(out, map[string]any{
			"id": v.ID.String(), "service_name": v.ServiceName, "price_minor": v.PriceMinor,
			"completed_at": v.CompletedAt, "appointment_id": v.AppointmentID.String(),
			"master_user_id": v.MasterUserID.String(),
		})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) addNote(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		VisitID string `json:"visit_id"`
		Body    string `json:"body"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	visitID, err := uuid.Parse(req.VisitID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid visit_id"))
		return
	}
	if err := a.svc.AddNote(r.Context(), id, claims.UserID, visitID, req.Body); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) addFormula(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Name       string          `json:"name"`
		Brand      string          `json:"brand"`
		Components json.RawMessage `json:"components"`
		Oxidizer   string          `json:"oxidizer"`
		Ratio      string          `json:"ratio"`
		Comment    string          `json:"comment"`
		VisitID    *string         `json:"visit_id"`
		OmitFormula bool           `json:"omit_formula"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	var visitID *uuid.UUID
	if req.VisitID != nil && *req.VisitID != "" {
		v, err := uuid.Parse(*req.VisitID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid visit_id"))
			return
		}
		visitID = &v
	}
	f, err := a.svc.AddFormula(r.Context(), id, claims.UserID, req.Name, req.Brand, req.Components, req.Oxidizer, req.Ratio, req.Comment, visitID, req.OmitFormula)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, formulaDTO(*f))
}

func (a *API) formulas(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	items, err := a.svc.ListFormulas(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, f := range items {
		out = append(out, formulaDTO(f))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) consent(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		ConsentType string `json:"consent_type"`
		Granted     bool   `json:"granted"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	if err := a.svc.SetConsent(r.Context(), id, claims.UserID, req.ConsentType, req.Granted); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func cardDTO(c domain.ClientCard) map[string]any {
	return map[string]any{
		"id": c.ID.String(), "organization_id": c.OrganizationID.String(), "user_id": c.UserID.String(),
		"display_name": c.DisplayName, "phone": c.Phone, "email": c.Email, "preferences": c.Preferences,
		"contacts_hidden": c.ContactsHidden,
	}
}

func cardListDTO(item domain.ClientCardListItem) map[string]any {
	dto := cardDTO(item.Card)
	dto["segment"] = item.Segment
	dto["visit_count"] = item.VisitCount
	if item.LastVisitAt != nil {
		dto["last_visit_at"] = *item.LastVisitAt
	} else {
		dto["last_visit_at"] = nil
	}
	if item.FirstVisitAt != nil {
		dto["first_visit_at"] = *item.FirstVisitAt
	} else {
		dto["first_visit_at"] = nil
	}
	return dto
}

func formulaDTO(f domain.ColorFormula) map[string]any {
	dto := map[string]any{
		"id": f.ID.String(), "created_at": f.CreatedAt, "omit_formula": f.OmitFormula, "redacted": f.Redacted,
		"created_by": f.CreatedBy.String(),
	}
	if f.VisitID != nil {
		dto["visit_id"] = f.VisitID.String()
	}
	if f.Redacted {
		return dto
	}
	dto["name"] = f.Name
	dto["brand"] = f.Brand
	dto["components"] = json.RawMessage(f.Components)
	dto["oxidizer"] = f.Oxidizer
	dto["ratio"] = f.Ratio
	dto["comment"] = f.Comment
	return dto
}

func disputeDTO(d domain.CardDispute) map[string]any {
	return map[string]any{
		"id": d.ID.String(), "client_card_id": d.ClientCardID.String(), "reporter_user_id": d.ReporterUserID.String(),
		"field_key": d.FieldKey, "comment": d.Comment, "status": d.Status, "created_at": d.CreatedAt,
		"resolved_at": d.ResolvedAt, "resolved_by": d.ResolvedBy,
	}
}

func (a *API) internalFormula(w http.ResponseWriter, r *http.Request) {
	if err := a.svc.CheckInternal(r.Header.Get("X-Internal-Token")); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	var req struct {
		AppointmentID string          `json:"appointment_id"`
		MasterUserID  string          `json:"master_user_id"`
		Name          string          `json:"name"`
		Brand         string          `json:"brand"`
		Components    json.RawMessage `json:"components"`
		Oxidizer      string          `json:"oxidizer"`
		Ratio         string          `json:"ratio"`
		Comment       string          `json:"comment"`
		OmitFormula   bool            `json:"omit_formula"`
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
	masterID := uuid.Nil
	if req.MasterUserID != "" {
		masterID, err = uuid.Parse(req.MasterUserID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid master_user_id"))
			return
		}
	}
	f, err := a.svc.InternalUpsertFormula(r.Context(), service.InternalFormulaInput{
		AppointmentID: apptID, MasterUserID: masterID, Name: req.Name, Brand: req.Brand,
		Components: req.Components, Oxidizer: req.Oxidizer, Ratio: req.Ratio, Comment: req.Comment, OmitFormula: req.OmitFormula,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, formulaDTO(*f))
}

func (a *API) createDispute(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		FieldKey string `json:"field_key"`
		Comment  string `json:"comment"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	d, already, err := a.svc.CreateDispute(r.Context(), id, claims.UserID, req.FieldKey, req.Comment)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	status := http.StatusCreated
	if already {
		status = http.StatusOK
	}
	httpx.JSON(w, status, map[string]any{"dispute": disputeDTO(*d), "already_open": already})
}

func (a *API) listDisputes(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	items, err := a.svc.ListDisputes(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, d := range items {
		out = append(out, disputeDTO(d))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) resolveDispute(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("disputeID"))
	if err != nil {
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
	d, err := a.svc.ResolveDispute(r.Context(), id, claims.UserID, req.Status)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, disputeDTO(*d))
}
