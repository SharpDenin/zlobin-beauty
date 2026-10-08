package httpapi

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerContactRoutes(mux *http.ServeMux, auth func(http.Handler) http.Handler) {
	mux.Handle("GET /v1/contacts", auth(http.HandlerFunc(a.listContacts)))
	mux.Handle("POST /v1/contacts", auth(http.HandlerFunc(a.createContact)))
	mux.Handle("GET /v1/contacts/search", auth(http.HandlerFunc(a.searchContacts)))
	mux.Handle("PATCH /v1/contacts/{id}", auth(http.HandlerFunc(a.patchContact)))
	mux.Handle("DELETE /v1/contacts/{id}", auth(http.HandlerFunc(a.deleteContact)))
}

func (a *API) listContacts(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	q := r.URL.Query()
	limit, offset := parseLimitOffset(q.Get("limit"), q.Get("offset"))
	res, err := a.svc.ListContacts(r.Context(), claims.UserID, q.Get("q"), q.Get("role"), limit, offset)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	items := make([]map[string]any, 0, len(res.Items))
	for _, c := range res.Items {
		items = append(items, contactViewDTO(c))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"items": items, "total": res.Total, "limit": res.Limit, "offset": res.Offset,
	})
}

func (a *API) createContact(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		UserID *string `json:"user_id"`
		Email  string  `json:"email"`
		Phone  string  `json:"phone"`
		Note   string  `json:"note"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	in := service.AddContactInput{ActorID: claims.UserID, Email: req.Email, Phone: req.Phone, Note: req.Note}
	if req.UserID != nil && strings.TrimSpace(*req.UserID) != "" {
		id, err := uuid.Parse(strings.TrimSpace(*req.UserID))
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid user_id"))
			return
		}
		in.UserID = &id
	}
	view, created, err := a.svc.AddContact(r.Context(), in)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	httpx.JSON(w, status, contactViewDTO(*view))
}

func (a *API) searchContacts(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	items, err := a.svc.SearchContactsDirectory(r.Context(), claims.UserID, r.URL.Query().Get("q"))
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, h := range items {
		out = append(out, contactSearchDTO(h))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) patchContact(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Note *string `json:"note"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	if req.Note == nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("note is required"))
		return
	}
	view, err := a.svc.UpdateContactNote(r.Context(), claims.UserID, id, *req.Note)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, contactViewDTO(*view))
}

func (a *API) deleteContact(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	if err := a.svc.DeleteContact(r.Context(), claims.UserID, id); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func contactViewDTO(c domain.ContactView) map[string]any {
	roles := c.Roles
	if roles == nil {
		roles = []string{}
	}
	var avatar any
	if c.AvatarMediaID != nil {
		avatar = c.AvatarMediaID.String()
	}
	var conv any
	if c.ConversationID != nil {
		conv = c.ConversationID.String()
	}
	return map[string]any{
		"id": c.ID.String(), "user_id": c.UserID.String(), "display_name": c.DisplayName,
		"roles": roles, "city": c.City, "avatar_media_id": avatar, "note": c.Note,
		"conversation_id": conv, "created_at": c.CreatedAt,
	}
}

func contactSearchDTO(h domain.ContactSearchHit) map[string]any {
	roles := h.Roles
	if roles == nil {
		roles = []string{}
	}
	var avatar any
	if h.AvatarMediaID != nil {
		avatar = h.AvatarMediaID.String()
	}
	return map[string]any{
		"id": h.ID.String(), "display_name": h.DisplayName, "roles": roles, "city": h.City,
		"avatar_media_id": avatar, "already_added": h.AlreadyAdded,
	}
}
