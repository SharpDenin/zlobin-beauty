package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
	"github.com/zlobin/zlobin-beauty/backend/shared/moderation"
)

type MessengerDeps struct {
	IdentityURL      string
	OrganizationsURL string
	MarketplaceURL   string
	MediaURL         string
	InternalToken    string
}

func (s *Service) WithMessenger(d MessengerDeps) *Service {
	s.identityURL = strings.TrimRight(d.IdentityURL, "/")
	s.organizationsURL = strings.TrimRight(d.OrganizationsURL, "/")
	s.marketplaceURL = strings.TrimRight(d.MarketplaceURL, "/")
	s.mediaURL = strings.TrimRight(d.MediaURL, "/")
	s.internalToken = d.InternalToken
	return s
}

func ContextKeyClientMaster(a, b uuid.UUID) string {
	min, max := orderedUUIDs(a, b)
	return "cm:" + min.String() + ":" + max.String()
}

func ContextKeyMasterSupplier(masterUser, supplierOrg uuid.UUID) string {
	return "ms:" + masterUser.String() + ":" + supplierOrg.String()
}

func ContextKeyMasterclass(eventID, a, b uuid.UUID) string {
	min, max := orderedUUIDs(a, b)
	return "mc:" + eventID.String() + ":" + min.String() + ":" + max.String()
}

func ContextKeyModelRequest(requestID, a, b uuid.UUID) string {
	min, max := orderedUUIDs(a, b)
	return "mr:" + requestID.String() + ":" + min.String() + ":" + max.String()
}

func orderedUUIDs(a, b uuid.UUID) (uuid.UUID, uuid.UUID) {
	if a.String() < b.String() {
		return a, b
	}
	return b, a
}

type CreateConversationInput struct {
	ActorID                uuid.UUID
	Type                   string
	MasterUserID           *uuid.UUID
	ClientUserID           *uuid.UUID
	SupplierOrganizationID *uuid.UUID
	EventID                *uuid.UUID
	RequestID              *uuid.UUID
	PeerUserID             *uuid.UUID
}

func (s *Service) CreateConversation(ctx context.Context, in CreateConversationInput) (*domain.Conversation, error) {
	typ := strings.TrimSpace(in.Type)
	switch typ {
	case domain.ConversationClientMaster:
		return s.createClientMaster(ctx, in)
	case domain.ConversationMasterSupplier:
		orgID := in.SupplierOrganizationID
		if orgID == nil && in.PeerUserID != nil {
			resolved, err := s.fetchSupplierOrgForUser(ctx, *in.PeerUserID)
			if err != nil {
				return nil, err
			}
			orgID = &resolved
		}
		return s.createMasterSupplier(ctx, in.ActorID, in.MasterUserID, orgID)
	case domain.ConversationMasterclass:
		return s.createMasterclassChat(ctx, in.ActorID, in.EventID, in.PeerUserID)
	case domain.ConversationModelRequest:
		return s.createModelRequestChat(ctx, in.ActorID, in.RequestID, in.PeerUserID)
	default:
		return nil, apperr.Validation("unsupported conversation type")
	}
}

func (s *Service) createClientMaster(ctx context.Context, in CreateConversationInput) (*domain.Conversation, error) {
	actor := in.ActorID
	var clientID, masterID uuid.UUID
	if in.ClientUserID != nil {
		clientID = *in.ClientUserID
		masterID = actor
		if clientID == actor {
			return nil, apperr.Validation("cannot message yourself")
		}
		published, err := s.fetchPublishedMaster(ctx, masterID)
		if err != nil {
			return nil, err
		}
		if !published {
			return nil, apperr.Forbidden("only a published master can message a client")
		}
		related, err := s.fetchBookingRelationship(ctx, masterID, clientID)
		if err != nil {
			return nil, err
		}
		if !related {
			// Address book is an explicit working relationship (USER_FLOWS: messages from contacts).
			linked, linkErr := s.hasAddressBookLink(ctx, masterID, clientID)
			if linkErr != nil {
				return nil, linkErr
			}
			if !linked {
				return nil, apperr.Forbidden("no booking relationship with this client")
			}
		}
	} else {
		if in.MasterUserID == nil {
			return nil, apperr.Validation("master_user_id is required")
		}
		masterID = *in.MasterUserID
		clientID = actor
		if masterID == actor {
			return nil, apperr.Validation("cannot message yourself")
		}
		published, err := s.fetchPublishedMaster(ctx, masterID)
		if err != nil {
			return nil, err
		}
		if !published {
			return nil, apperr.Forbidden("master is not available")
		}
	}
	key := ContextKeyClientMaster(clientID, masterID)
	now := s.now().UTC()
	c := domain.Conversation{
		ID: ids.New(), Type: domain.ConversationClientMaster, ContextKey: key,
		ContextType: "master_user", ContextID: &masterID, CreatedAt: now, UpdatedAt: now,
	}
	parts := []domain.Participant{
		{ConversationID: c.ID, UserID: clientID, ParticipantRole: "client", JoinedAt: now},
		{ConversationID: c.ID, UserID: masterID, ParticipantRole: "master", JoinedAt: now},
	}
	return s.findOrInsert(ctx, c, parts, actor)
}

func (s *Service) createMasterSupplier(ctx context.Context, actor uuid.UUID, masterUserID, supplierOrgID *uuid.UUID) (*domain.Conversation, error) {
	if supplierOrgID == nil {
		return nil, apperr.Validation("supplier_organization_id is required")
	}
	org, err := s.fetchPublishedSupplier(ctx, *supplierOrgID)
	if err != nil {
		return nil, err
	}
	if !org {
		return nil, apperr.Forbidden("supplier is not available")
	}
	ownerID, err := s.fetchOrgOwner(ctx, *supplierOrgID)
	if err != nil {
		return nil, err
	}
	masterID := actor
	if masterUserID != nil && *masterUserID != actor {
		// Supplier owner opening an existing pair with a specific master.
		if actor != ownerID {
			return nil, apperr.Forbidden("not allowed")
		}
		masterID = *masterUserID
	} else {
		ok, err := s.fetchPublishedMaster(ctx, actor)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, apperr.Forbidden("only a published master can message a supplier")
		}
		if actor == ownerID {
			return nil, apperr.Validation("cannot message your own organization")
		}
	}
	key := ContextKeyMasterSupplier(masterID, *supplierOrgID)
	now := s.now().UTC()
	c := domain.Conversation{
		ID: ids.New(), Type: domain.ConversationMasterSupplier, ContextKey: key,
		ContextType: "supplier_organization", ContextID: supplierOrgID, CreatedAt: now, UpdatedAt: now,
	}
	parts := []domain.Participant{
		{ConversationID: c.ID, UserID: masterID, ParticipantRole: "master", JoinedAt: now},
		{ConversationID: c.ID, UserID: ownerID, ParticipantRole: "supplier", JoinedAt: now},
	}
	return s.findOrInsert(ctx, c, parts, actor)
}

func (s *Service) createMasterclassChat(ctx context.Context, actor uuid.UUID, eventID, peerID *uuid.UUID) (*domain.Conversation, error) {
	if eventID == nil || peerID == nil {
		return nil, apperr.Validation("event_id and peer_user_id are required")
	}
	if *peerID == actor {
		return nil, apperr.Validation("cannot message yourself")
	}
	instructorID, registered, err := s.fetchMasterclassAccess(ctx, *eventID, actor, *peerID)
	if err != nil {
		return nil, err
	}
	if !registered {
		return nil, apperr.Forbidden("masterclass conversation is not allowed")
	}
	key := ContextKeyMasterclass(*eventID, actor, *peerID)
	now := s.now().UTC()
	c := domain.Conversation{
		ID: ids.New(), Type: domain.ConversationMasterclass, ContextKey: key,
		ContextType: "masterclass", ContextID: eventID, CreatedAt: now, UpdatedAt: now,
	}
	roleActor, rolePeer := "participant", "instructor"
	if actor == instructorID {
		roleActor, rolePeer = "instructor", "participant"
	}
	parts := []domain.Participant{
		{ConversationID: c.ID, UserID: actor, ParticipantRole: roleActor, JoinedAt: now},
		{ConversationID: c.ID, UserID: *peerID, ParticipantRole: rolePeer, JoinedAt: now},
	}
	return s.findOrInsert(ctx, c, parts, actor)
}

func (s *Service) createModelRequestChat(ctx context.Context, actor uuid.UUID, requestID, peerID *uuid.UUID) (*domain.Conversation, error) {
	if requestID == nil || peerID == nil {
		return nil, apperr.Validation("request_id and peer_user_id are required")
	}
	if *peerID == actor {
		return nil, apperr.Validation("cannot message yourself")
	}
	ok, err := s.fetchModelRequestAccess(ctx, *requestID, actor, *peerID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, apperr.Forbidden("model request conversation is not allowed")
	}
	key := ContextKeyModelRequest(*requestID, actor, *peerID)
	now := s.now().UTC()
	c := domain.Conversation{
		ID: ids.New(), Type: domain.ConversationModelRequest, ContextKey: key,
		ContextType: "model_request", ContextID: requestID, CreatedAt: now, UpdatedAt: now,
	}
	parts := []domain.Participant{
		{ConversationID: c.ID, UserID: actor, ParticipantRole: "client", JoinedAt: now},
		{ConversationID: c.ID, UserID: *peerID, ParticipantRole: "master", JoinedAt: now},
	}
	return s.findOrInsert(ctx, c, parts, actor)
}

func (s *Service) findOrInsert(ctx context.Context, c domain.Conversation, parts []domain.Participant, actor uuid.UUID) (*domain.Conversation, error) {
	existing, err := s.store.FindConversationByKey(ctx, c.ContextKey)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if existing != nil {
		return s.GetConversation(ctx, existing.ID, actor)
	}
	if err := s.store.InsertConversation(ctx, c, parts); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			existing, err = s.store.FindConversationByKey(ctx, c.ContextKey)
			if err != nil {
				return nil, apperr.Internal(err)
			}
			if existing == nil {
				return nil, apperr.Internal(fmt.Errorf("conversation conflict without row"))
			}
			return s.GetConversation(ctx, existing.ID, actor)
		}
		return nil, apperr.Internal(err)
	}
	return s.GetConversation(ctx, c.ID, actor)
}

func (s *Service) ListConversations(ctx context.Context, actor uuid.UUID, limit, offset int) ([]domain.Conversation, error) {
	items, err := s.store.ListConversationsForUser(ctx, actor, limit, offset)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	out := make([]domain.Conversation, 0, len(items))
	for i := range items {
		hydrated, err := s.hydrate(ctx, items[i], actor)
		if err != nil {
			return nil, err
		}
		out = append(out, *hydrated)
	}
	return out, nil
}

func (s *Service) GetConversation(ctx context.Context, id, actor uuid.UUID) (*domain.Conversation, error) {
	c, err := s.store.GetConversation(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if c == nil {
		return nil, apperr.NotFound("conversation not found")
	}
	ok, err := s.store.IsParticipant(ctx, id, actor)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if !ok {
		return nil, apperr.Forbidden("not a conversation participant")
	}
	return s.hydrate(ctx, *c, actor)
}

func (s *Service) hydrate(ctx context.Context, c domain.Conversation, actor uuid.UUID) (*domain.Conversation, error) {
	parts, err := s.store.ListParticipants(ctx, c.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	names := map[uuid.UUID]string{}
	var lastRead *time.Time
	for i := range parts {
		if parts[i].UserID == actor {
			lastRead = parts[i].LastReadAt
		}
		names[parts[i].UserID] = s.displayName(ctx, parts[i].UserID)
		parts[i].DisplayName = names[parts[i].UserID]
	}
	last, err := s.store.LastMessage(ctx, c.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	unread, err := s.store.UnreadCount(ctx, c.ID, actor, lastRead)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	c.Participants = parts
	c.LastMessage = last
	c.UnreadCount = unread
	return &c, nil
}

func (s *Service) ListMessages(ctx context.Context, conversationID, actor uuid.UUID, limit int, before *time.Time) ([]domain.Message, bool, error) {
	if err := s.requireParticipant(ctx, conversationID, actor); err != nil {
		return nil, false, err
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	items, err := s.store.ListMessages(ctx, conversationID, limit+1, before)
	if err != nil {
		return nil, false, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.Message{}
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[1:]
	}
	return items, hasMore, nil
}

type SendMessageInput struct {
	Body    string
	MediaID *uuid.UUID
}

func ValidateMessageContent(body string, hasMedia bool) error {
	body = store.NormalizeBody(body)
	if body == "" && !hasMedia {
		return apperr.Validation("message text or attachment is required")
	}
	if len([]rune(body)) > domain.MaxMessageRunes {
		return apperr.Validation("body is too long")
	}
	if body != "" {
		if err := moderation.ValidateFields(map[string]string{"body": body}); err != nil {
			return err
		}
	}
	return nil
}

func MessageKindFromContentType(ct string, hasMedia bool) string {
	if !hasMedia {
		return domain.MessageKindText
	}
	ct = strings.ToLower(strings.TrimSpace(ct))
	if strings.HasPrefix(ct, "video/") {
		return domain.MessageKindVideo
	}
	return domain.MessageKindImage
}

func (s *Service) SendMessage(ctx context.Context, conversationID, actor uuid.UUID, in SendMessageInput) (*domain.Message, error) {
	if err := s.requireParticipant(ctx, conversationID, actor); err != nil {
		return nil, err
	}
	body := store.NormalizeBody(in.Body)
	if err := ValidateMessageContent(body, in.MediaID != nil); err != nil {
		return nil, err
	}
	kind := domain.MessageKindText
	if in.MediaID != nil {
		meta, err := s.fetchMedia(ctx, *in.MediaID)
		if err != nil {
			return nil, err
		}
		if meta.OwnerUserID != actor {
			return nil, apperr.Forbidden("attachment does not belong to you")
		}
		if meta.Purpose != "message" {
			return nil, apperr.Validation("attachment must be uploaded with purpose=message")
		}
		kind = MessageKindFromContentType(meta.ContentType, true)
	}
	now := s.now().UTC()
	m := domain.Message{
		ID: ids.New(), ConversationID: conversationID, SenderUserID: actor,
		Kind: kind, Body: body, MediaID: in.MediaID, CreatedAt: now,
	}
	if err := s.store.InsertMessage(ctx, m); err != nil {
		return nil, apperr.Internal(err)
	}
	s.notifyNewMessage(ctx, conversationID, actor, messagePreview(m))
	return &m, nil
}

func (s *Service) MediaAccessible(ctx context.Context, mediaID, userID uuid.UUID) (bool, error) {
	ok, err := s.store.UserCanAccessMedia(ctx, mediaID, userID)
	if err != nil {
		return false, apperr.Internal(err)
	}
	return ok, nil
}

func (s *Service) MarkConversationRead(ctx context.Context, conversationID, actor uuid.UUID) error {
	if err := s.requireParticipant(ctx, conversationID, actor); err != nil {
		return err
	}
	if err := s.store.MarkConversationRead(ctx, conversationID, actor, s.now().UTC()); err != nil {
		if ae, ok := apperr.As(err); ok {
			return ae
		}
		return apperr.Internal(err)
	}
	return nil
}

func (s *Service) requireParticipant(ctx context.Context, conversationID, actor uuid.UUID) error {
	c, err := s.store.GetConversation(ctx, conversationID)
	if err != nil {
		return apperr.Internal(err)
	}
	if c == nil {
		return apperr.NotFound("conversation not found")
	}
	ok, err := s.store.IsParticipant(ctx, conversationID, actor)
	if err != nil {
		return apperr.Internal(err)
	}
	if !ok {
		return apperr.Forbidden("not a conversation participant")
	}
	return nil
}

func messagePreview(m domain.Message) string {
	body := strings.TrimSpace(m.Body)
	if body != "" {
		runes := []rune(body)
		if len(runes) > 80 {
			return string(runes[:80]) + "…"
		}
		return body
	}
	switch m.Kind {
	case domain.MessageKindVideo:
		return "Видео"
	case domain.MessageKindImage:
		return "Фото"
	default:
		return "Сообщение"
	}
}

func (s *Service) notifyNewMessage(ctx context.Context, conversationID, sender uuid.UUID, preview string) {
	parts, err := s.store.ListParticipants(ctx, conversationID)
	if err != nil {
		return
	}
	from := s.displayName(ctx, sender)
	for _, p := range parts {
		if p.UserID == sender {
			continue
		}
		_ = s.CreateNotification(ctx, p.UserID, "new_message", "Новое сообщение от "+from, preview, "conversation", &conversationID)
	}
}

func (s *Service) displayName(ctx context.Context, userID uuid.UUID) string {
	if s.identityURL == "" || s.internalToken == "" {
		return "Пользователь"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.identityURL+"/v1/internal/users/"+userID.String(), nil)
	if err != nil {
		return "Пользователь"
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "Пользователь"
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return "Пользователь"
	}
	var u struct {
		DisplayName string `json:"display_name"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&u); err != nil {
		return "Пользователь"
	}
	if strings.TrimSpace(u.DisplayName) == "" {
		return "Пользователь"
	}
	return strings.TrimSpace(u.DisplayName)
}

type mediaMeta struct {
	OwnerUserID uuid.UUID
	Purpose     string
	ContentType string
}

func (s *Service) fetchMedia(ctx context.Context, id uuid.UUID) (*mediaMeta, error) {
	if s.mediaURL == "" || s.internalToken == "" {
		return nil, apperr.Internal(fmt.Errorf("media is not configured"))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.mediaURL+"/v1/internal/media/"+id.String(), nil)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, apperr.NotFound("attachment not found")
	}
	if resp.StatusCode >= 300 {
		return nil, apperr.Internal(fmt.Errorf("media status %d", resp.StatusCode))
	}
	var body struct {
		OwnerUserID string `json:"owner_user_id"`
		Purpose     string `json:"purpose"`
		ContentType string `json:"content_type"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&body); err != nil {
		return nil, apperr.Internal(err)
	}
	owner, err := uuid.Parse(body.OwnerUserID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return &mediaMeta{OwnerUserID: owner, Purpose: body.Purpose, ContentType: body.ContentType}, nil
}

func (s *Service) hasAddressBookLink(ctx context.Context, a, b uuid.UUID) (bool, error) {
	if s.store == nil {
		return false, nil
	}
	c, err := s.store.GetContactByOwnerPair(ctx, a, b)
	if err != nil {
		return false, apperr.Internal(err)
	}
	if c != nil {
		return true, nil
	}
	c, err = s.store.GetContactByOwnerPair(ctx, b, a)
	if err != nil {
		return false, apperr.Internal(err)
	}
	return c != nil, nil
}

func (s *Service) fetchSupplierOrgForUser(ctx context.Context, userID uuid.UUID) (uuid.UUID, error) {
	if s.organizationsURL == "" || s.internalToken == "" {
		return uuid.Nil, apperr.Internal(fmt.Errorf("organizations is not configured"))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		s.organizationsURL+"/v1/internal/users/"+userID.String()+"/supplier-organization", nil)
	if err != nil {
		return uuid.Nil, apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return uuid.Nil, apperr.Internal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return uuid.Nil, apperr.NotFound("supplier organization not found")
	}
	if resp.StatusCode >= 300 {
		return uuid.Nil, apperr.Internal(fmt.Errorf("organizations status %d", resp.StatusCode))
	}
	var body struct {
		OrganizationID string `json:"organization_id"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&body); err != nil {
		return uuid.Nil, apperr.Internal(err)
	}
	id, err := uuid.Parse(body.OrganizationID)
	if err != nil {
		return uuid.Nil, apperr.Internal(err)
	}
	return id, nil
}

func (s *Service) fetchBookingRelationship(ctx context.Context, masterUserID, clientUserID uuid.UUID) (bool, error) {
	if s.bookingURL == "" || s.internalToken == "" {
		return false, apperr.Internal(fmt.Errorf("booking is not configured"))
	}
	u, err := url.Parse(s.bookingURL + "/v1/internal/client-master-relationship")
	if err != nil {
		return false, apperr.Internal(err)
	}
	q := u.Query()
	q.Set("master_user_id", masterUserID.String())
	q.Set("client_user_id", clientUserID.String())
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return false, apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return false, apperr.Internal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return false, apperr.Internal(fmt.Errorf("booking status %d", resp.StatusCode))
	}
	var body struct {
		Related bool `json:"related"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&body); err != nil {
		return false, apperr.Internal(err)
	}
	return body.Related, nil
}

func (s *Service) fetchPublishedMaster(ctx context.Context, userID uuid.UUID) (bool, error) {
	if s.marketplaceURL == "" || s.internalToken == "" {
		return false, apperr.Internal(fmt.Errorf("marketplace is not configured"))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.marketplaceURL+"/v1/internal/masters/by-user/"+userID.String(), nil)
	if err != nil {
		return false, apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return false, apperr.Internal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if resp.StatusCode >= 300 {
		return false, apperr.Internal(fmt.Errorf("marketplace status %d", resp.StatusCode))
	}
	var body struct {
		Published bool `json:"published"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&body); err != nil {
		return false, apperr.Internal(err)
	}
	return body.Published, nil
}

func (s *Service) fetchPublishedSupplier(ctx context.Context, orgID uuid.UUID) (bool, error) {
	if s.organizationsURL == "" || s.internalToken == "" {
		return false, apperr.Internal(fmt.Errorf("organizations is not configured"))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.organizationsURL+"/v1/internal/organizations/"+orgID.String(), nil)
	if err != nil {
		return false, apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return false, apperr.Internal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if resp.StatusCode >= 300 {
		return false, apperr.Internal(fmt.Errorf("organizations status %d", resp.StatusCode))
	}
	var body struct {
		Type      string `json:"type"`
		Published bool   `json:"published"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&body); err != nil {
		return false, apperr.Internal(err)
	}
	return body.Type == "supplier" && body.Published, nil
}

func (s *Service) fetchOrgOwner(ctx context.Context, orgID uuid.UUID) (uuid.UUID, error) {
	u, _ := url.Parse(s.organizationsURL + "/v1/internal/organizations/" + orgID.String() + "/members")
	q := u.Query()
	q.Set("role", "owner")
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return uuid.Nil, apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return uuid.Nil, apperr.Internal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return uuid.Nil, apperr.Internal(fmt.Errorf("organizations members status %d", resp.StatusCode))
	}
	var body struct {
		Items []struct {
			UserID string `json:"user_id"`
			Status string `json:"status"`
		} `json:"items"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return uuid.Nil, apperr.Internal(err)
	}
	for _, it := range body.Items {
		if it.Status != "" && it.Status != "active" {
			continue
		}
		id, err := uuid.Parse(it.UserID)
		if err == nil {
			return id, nil
		}
	}
	return uuid.Nil, apperr.NotFound("supplier owner not found")
}

func (s *Service) fetchMasterclassAccess(ctx context.Context, eventID, actor, peer uuid.UUID) (instructor uuid.UUID, allowed bool, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.marketplaceURL+"/v1/internal/masterclasses/"+eventID.String()+"/access?actor_id="+actor.String()+"&peer_id="+peer.String(), nil)
	if err != nil {
		return uuid.Nil, false, apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return uuid.Nil, false, apperr.Internal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return uuid.Nil, false, apperr.NotFound("masterclass not found")
	}
	if resp.StatusCode >= 300 {
		return uuid.Nil, false, apperr.Internal(fmt.Errorf("marketplace status %d", resp.StatusCode))
	}
	var body struct {
		InstructorUserID string `json:"instructor_user_id"`
		Allowed          bool   `json:"allowed"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&body); err != nil {
		return uuid.Nil, false, apperr.Internal(err)
	}
	id, err := uuid.Parse(body.InstructorUserID)
	if err != nil {
		return uuid.Nil, false, apperr.Internal(err)
	}
	return id, body.Allowed, nil
}

func (s *Service) fetchModelRequestAccess(ctx context.Context, requestID, actor, peer uuid.UUID) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.marketplaceURL+"/v1/internal/model-requests/"+requestID.String()+"/access?actor_id="+actor.String()+"&peer_id="+peer.String(), nil)
	if err != nil {
		return false, apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return false, apperr.Internal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return false, apperr.NotFound("model request not found")
	}
	if resp.StatusCode >= 300 {
		return false, apperr.Internal(fmt.Errorf("marketplace status %d", resp.StatusCode))
	}
	var body struct {
		Allowed bool `json:"allowed"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&body); err != nil {
		return false, apperr.Internal(err)
	}
	return body.Allowed, nil
}
