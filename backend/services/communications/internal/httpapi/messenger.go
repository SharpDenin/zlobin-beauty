package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerMessengerRoutes(mux *http.ServeMux, auth func(http.Handler) http.Handler) {
	mux.Handle("GET /v1/conversations", auth(http.HandlerFunc(a.listConversations)))
	mux.Handle("POST /v1/conversations", auth(http.HandlerFunc(a.createConversation)))
	mux.Handle("GET /v1/conversations/{id}", auth(http.HandlerFunc(a.getConversation)))
	mux.Handle("GET /v1/conversations/{id}/messages", auth(http.HandlerFunc(a.listMessages)))
	mux.Handle("POST /v1/conversations/{id}/messages", auth(http.HandlerFunc(a.sendMessage)))
	mux.Handle("POST /v1/conversations/{id}/read", auth(http.HandlerFunc(a.readConversation)))
}

func (a *API) listConversations(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	limit, offset := parseLimitOffset(r.URL.Query().Get("limit"), r.URL.Query().Get("offset"))
	items, err := a.svc.ListConversations(r.Context(), claims.UserID, limit, offset)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, c := range items {
		out = append(out, conversationDTO(c, claims.UserID))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out, "limit": limit, "offset": offset})
}

func (a *API) createConversation(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		Type                   string  `json:"type"`
		MasterUserID           *string `json:"master_user_id"`
		ClientUserID           *string `json:"client_user_id"`
		SupplierOrganizationID *string `json:"supplier_organization_id"`
		EventID                *string `json:"event_id"`
		RequestID              *string `json:"request_id"`
		PeerUserID             *string `json:"peer_user_id"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	in := service.CreateConversationInput{ActorID: claims.UserID, Type: req.Type}
	var err error
	if in.MasterUserID, err = parseOptionalUUID(req.MasterUserID); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid master_user_id"))
		return
	}
	if in.ClientUserID, err = parseOptionalUUID(req.ClientUserID); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid client_user_id"))
		return
	}
	if in.SupplierOrganizationID, err = parseOptionalUUID(req.SupplierOrganizationID); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid supplier_organization_id"))
		return
	}
	if in.EventID, err = parseOptionalUUID(req.EventID); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid event_id"))
		return
	}
	if in.RequestID, err = parseOptionalUUID(req.RequestID); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid request_id"))
		return
	}
	if in.PeerUserID, err = parseOptionalUUID(req.PeerUserID); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid peer_user_id"))
		return
	}
	c, err := a.svc.CreateConversation(r.Context(), in)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, conversationDTO(*c, claims.UserID))
}

func (a *API) getConversation(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	c, err := a.svc.GetConversation(r.Context(), id, claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, conversationDTO(*c, claims.UserID))
}

func (a *API) listMessages(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	limit, _ := parseLimitOffset(r.URL.Query().Get("limit"), "0")
	var before *time.Time
	if v := r.URL.Query().Get("before"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid before timestamp"))
			return
		}
		before = &t
	}
	items, hasMore, err := a.svc.ListMessages(r.Context(), id, claims.UserID, limit, before)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, m := range items {
		out = append(out, messageDTO(m))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out, "limit": limit, "has_more": hasMore})
}

func (a *API) sendMessage(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Body    string  `json:"body"`
		MediaID *string `json:"media_id"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	mediaID, err := parseOptionalUUID(req.MediaID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid media_id"))
		return
	}
	m, err := a.svc.SendMessage(r.Context(), id, claims.UserID, service.SendMessageInput{Body: req.Body, MediaID: mediaID})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, messageDTO(*m))
}

func (a *API) readConversation(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	if err := a.svc.MarkConversationRead(r.Context(), id, claims.UserID); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) mediaAccess(w http.ResponseWriter, r *http.Request) {
	mediaID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	userID, err := uuid.Parse(r.URL.Query().Get("user_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid user_id"))
		return
	}
	ok, err := a.svc.MediaAccessible(r.Context(), mediaID, userID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"allowed": ok})
}

func parseOptionalUUID(raw *string) (*uuid.UUID, error) {
	if raw == nil || *raw == "" {
		return nil, nil
	}
	id, err := uuid.Parse(*raw)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func parseLimitOffset(limitStr, offsetStr string) (int, int) {
	limit := 50
	offset := 0
	if n, err := strconv.Atoi(limitStr); err == nil {
		limit = n
	}
	if n, err := strconv.Atoi(offsetStr); err == nil {
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

func conversationDTO(c domain.Conversation, actor uuid.UUID) map[string]any {
	parts := make([]map[string]any, 0, len(c.Participants))
	peerName := ""
	for _, p := range c.Participants {
		parts = append(parts, map[string]any{
			"user_id": p.UserID.String(), "role": p.ParticipantRole, "display_name": p.DisplayName,
			"joined_at": p.JoinedAt, "last_read_at": p.LastReadAt,
		})
		if p.UserID != actor && peerName == "" {
			peerName = p.DisplayName
		}
	}
	var last any
	if c.LastMessage != nil {
		last = messageDTO(*c.LastMessage)
	}
	var contextID any
	if c.ContextID != nil {
		contextID = c.ContextID.String()
	}
	return map[string]any{
		"id": c.ID.String(), "type": c.Type, "context_type": c.ContextType, "context_id": contextID,
		"created_at": c.CreatedAt, "updated_at": c.UpdatedAt,
		"participants": parts, "peer_name": peerName, "last_message": last, "unread_count": c.UnreadCount,
	}
}

func messageDTO(m domain.Message) map[string]any {
	body := m.Body
	if m.DeletedAt != nil {
		body = ""
	}
	kind := m.Kind
	if kind == "" {
		kind = domain.MessageKindText
	}
	var mediaID any
	if m.MediaID != nil {
		mediaID = m.MediaID.String()
	}
	return map[string]any{
		"id": m.ID.String(), "conversation_id": m.ConversationID.String(),
		"sender_user_id": m.SenderUserID.String(), "kind": kind, "body": body, "media_id": mediaID,
		"created_at": m.CreatedAt, "edited_at": m.EditedAt, "deleted_at": m.DeletedAt,
	}
}
