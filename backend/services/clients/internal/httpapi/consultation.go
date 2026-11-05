package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerConsultationRoutes(mux *http.ServeMux, auth func(http.Handler) http.Handler) {
	mux.Handle("GET /v1/hair-consultations", auth(http.HandlerFunc(a.listConsultations)))
	mux.Handle("POST /v1/hair-consultations", auth(http.HandlerFunc(a.createConsultation)))
	mux.Handle("GET /v1/hair-consultations/{id}", auth(http.HandlerFunc(a.getConsultation)))
	mux.Handle("PATCH /v1/hair-consultations/{id}/questionnaire", auth(http.HandlerFunc(a.patchQuestionnaire)))
	mux.Handle("PATCH /v1/hair-consultations/{id}/assessment", auth(http.HandlerFunc(a.patchAssessment)))
	mux.Handle("PATCH /v1/hair-consultations/{id}/plan", auth(http.HandlerFunc(a.patchPlan)))
	mux.Handle("POST /v1/hair-consultations/{id}/submit", auth(http.HandlerFunc(a.submitConsultation)))
	mux.Handle("POST /v1/hair-consultations/{id}/start", auth(http.HandlerFunc(a.startConsultation)))
	mux.Handle("POST /v1/hair-consultations/{id}/send", auth(http.HandlerFunc(a.sendConsultation)))
	mux.Handle("POST /v1/hair-consultations/{id}/approve", auth(http.HandlerFunc(a.approveConsultation)))
	mux.Handle("POST /v1/hair-consultations/{id}/request-changes", auth(http.HandlerFunc(a.requestChanges)))
	mux.Handle("POST /v1/hair-consultations/{id}/revisions", auth(http.HandlerFunc(a.createRevision)))
	mux.Handle("POST /v1/hair-consultations/{id}/media", auth(http.HandlerFunc(a.attachMedia)))
	mux.Handle("DELETE /v1/hair-consultations/{id}/media/{mediaId}", auth(http.HandlerFunc(a.detachMedia)))
	mux.HandleFunc("GET /v1/internal/media/{id}/access", a.internalMediaAccess)
}

func (a *API) listConsultations(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	asMaster := r.URL.Query().Get("as") == "master"
	items, err := a.svc.ListHairConsultations(r.Context(), claims.UserID, asMaster)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, c := range items {
		out = append(out, consultListDTO(c))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) createConsultation(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		MasterUserID   string  `json:"master_user_id"`
		OrganizationID *string `json:"organization_id"`
		ClientCardID   *string `json:"client_card_id"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	masterID, err := uuid.Parse(req.MasterUserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid master_user_id"))
		return
	}
	in := service.CreateHairConsultationInput{MasterUserID: masterID}
	if req.OrganizationID != nil && *req.OrganizationID != "" {
		id, err := uuid.Parse(*req.OrganizationID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid organization_id"))
			return
		}
		in.OrganizationID = &id
	}
	if req.ClientCardID != nil && *req.ClientCardID != "" {
		id, err := uuid.Parse(*req.ClientCardID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid client_card_id"))
			return
		}
		in.ClientCardID = &id
	}
	c, err := a.svc.CreateHairConsultation(r.Context(), claims.UserID, in)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, consultDTO(*c))
}

func (a *API) getConsultation(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	c, err := a.svc.GetHairConsultation(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, consultDTO(*c))
}

func (a *API) patchQuestionnaire(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Questionnaire json.RawMessage `json:"questionnaire"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	c, err := a.svc.PatchQuestionnaire(r.Context(), id, claims.UserID, service.PatchQuestionnaireInput{Questionnaire: req.Questionnaire})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, consultDTO(*c))
}

func (a *API) patchAssessment(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Assessment json.RawMessage `json:"assessment"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	c, err := a.svc.PatchAssessment(r.Context(), id, claims.UserID, service.PatchAssessmentInput{Assessment: req.Assessment})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, consultDTO(*c))
}

func (a *API) patchPlan(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Plan json.RawMessage `json:"plan"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	c, err := a.svc.PatchPlan(r.Context(), id, claims.UserID, service.PatchPlanInput{Plan: req.Plan})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, consultDTO(*c))
}

func (a *API) submitConsultation(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	c, err := a.svc.SubmitHairConsultation(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, consultDTO(*c))
}

func (a *API) startConsultation(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	c, err := a.svc.StartHairConsultation(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, consultDTO(*c))
}

func (a *API) sendConsultation(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		ConversationID *string `json:"conversation_id"`
	}
	_ = httpx.DecodeJSON(r, &req)
	in := service.SendPlanInput{}
	if req.ConversationID != nil && *req.ConversationID != "" {
		cid, err := uuid.Parse(*req.ConversationID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid conversation_id"))
			return
		}
		in.ConversationID = &cid
	}
	c, err := a.svc.SendHairConsultationPlan(r.Context(), id, claims.UserID, in)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, consultDTO(*c))
}

func (a *API) approveConsultation(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	c, err := a.svc.ApproveHairConsultation(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, consultDTO(*c))
}

func (a *API) requestChanges(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Comment string `json:"comment"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	c, err := a.svc.RequestHairConsultationChanges(r.Context(), id, claims.UserID, service.RequestChangesInput{Comment: req.Comment})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, consultDTO(*c))
}

func (a *API) createRevision(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	c, err := a.svc.CreateHairConsultationRevision(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, consultDTO(*c))
}

func (a *API) attachMedia(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		MediaID string `json:"media_id"`
		Slot    string `json:"slot"`
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
	c, err := a.svc.AttachHairConsultationMedia(r.Context(), id, claims.UserID, service.AttachMediaInput{MediaID: mediaID, Slot: req.Slot})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, consultDTO(*c))
}

func (a *API) detachMedia(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	mediaID, err := uuid.Parse(r.PathValue("mediaId"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid media id"))
		return
	}
	c, err := a.svc.DetachHairConsultationMedia(r.Context(), id, claims.UserID, mediaID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, consultDTO(*c))
}

func (a *API) internalMediaAccess(w http.ResponseWriter, r *http.Request) {
	if err := a.svc.CheckInternal(r.Header.Get("X-Internal-Token")); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	mediaID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid media id"))
		return
	}
	userID, err := uuid.Parse(r.URL.Query().Get("user_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("user_id is required"))
		return
	}
	allowed, err := a.svc.MediaVisibleToUser(r.Context(), mediaID, userID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"allowed": allowed})
}

func consultListDTO(c domain.HairConsultation) map[string]any {
	m := map[string]any{
		"id": c.ID.String(), "client_user_id": c.ClientUserID.String(), "master_user_id": c.MasterUserID.String(),
		"status": c.Status, "created_at": c.CreatedAt, "updated_at": c.UpdatedAt,
	}
	if c.OrganizationID != nil {
		m["organization_id"] = c.OrganizationID.String()
	}
	if c.CurrentVersionID != nil {
		m["current_version_id"] = c.CurrentVersionID.String()
	}
	if c.ConversationID != nil {
		m["conversation_id"] = c.ConversationID.String()
	}
	if c.CurrentVersion != nil {
		m["current_version"] = versionDTO(*c.CurrentVersion)
	}
	return m
}

func consultDTO(c domain.HairConsultation) map[string]any {
	m := consultListDTO(c)
	if c.ClientCardID != nil {
		m["client_card_id"] = c.ClientCardID.String()
	}
	versions := make([]map[string]any, 0, len(c.Versions))
	for _, v := range c.Versions {
		versions = append(versions, versionDTO(v))
	}
	m["versions"] = versions
	events := make([]map[string]any, 0, len(c.Events))
	for _, e := range c.Events {
		ev := map[string]any{
			"id": e.ID.String(), "actor_user_id": e.ActorUserID.String(), "action": e.Action,
			"to_status": e.ToStatus, "created_at": e.CreatedAt, "meta": jsonRaw(e.Meta),
		}
		if e.VersionID != nil {
			ev["version_id"] = e.VersionID.String()
		}
		if e.FromStatus != nil {
			ev["from_status"] = *e.FromStatus
		}
		events = append(events, ev)
	}
	m["events"] = events
	return m
}

func versionDTO(v domain.HairConsultationVersion) map[string]any {
	m := map[string]any{
		"id": v.ID.String(), "consultation_id": v.ConsultationID.String(), "version_no": v.VersionNo,
		"status": v.Status, "client_questionnaire": jsonRaw(v.ClientQuestionnaire),
		"master_assessment": jsonRaw(v.MasterAssessment), "plan": jsonRaw(v.Plan),
		"client_comment": v.ClientComment, "created_by": v.CreatedBy.String(),
		"created_at": v.CreatedAt, "updated_at": v.UpdatedAt,
		"submitted_at": v.SubmittedAt, "sent_at": v.SentAt, "approved_at": v.ApprovedAt, "immutable_at": v.ImmutableAt,
	}
	media := make([]map[string]any, 0, len(v.Media))
	for _, x := range v.Media {
		media = append(media, map[string]any{
			"id": x.ID.String(), "media_id": x.MediaID.String(), "slot": x.Slot,
			"uploaded_by": x.UploadedBy.String(), "created_at": x.CreatedAt,
		})
	}
	m["media"] = media
	return m
}

func jsonRaw(raw json.RawMessage) any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return map[string]any{}
	}
	return v
}
