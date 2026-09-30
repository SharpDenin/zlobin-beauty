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
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
	"github.com/zlobin/zlobin-beauty/backend/shared/moderation"
)

type AddContactInput struct {
	ActorID uuid.UUID
	UserID  *uuid.UUID
	Email   string
	Phone   string
	Note    string
}

type ContactListResult struct {
	Items  []domain.ContactView
	Total  int
	Limit  int
	Offset int
}

type identityPublicUser struct {
	ID          uuid.UUID
	DisplayName string
	Roles       []string
	City        string
}

func ClampContactPagination(limit, offset int) (int, int) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func NormalizeContactNote(note string) (string, error) {
	note = strings.TrimSpace(note)
	if utf8.RuneCountInString(note) > domain.MaxContactNoteRunes {
		return "", apperr.Validation("note must be at most 200 characters")
	}
	if err := moderation.ValidateFields(map[string]string{"note": note}); err != nil {
		return "", err
	}
	return note, nil
}

func ValidateContactSearchQuery(q string) error {
	q = strings.TrimSpace(q)
	if utf8.RuneCountInString(q) < 2 {
		return apperr.Validation("q must be at least 2 characters")
	}
	return nil
}

func FilterContactSearchHits(actor uuid.UUID, added map[uuid.UUID]struct{}, hits []identityPublicUser) []domain.ContactSearchHit {
	out := make([]domain.ContactSearchHit, 0, len(hits))
	for _, h := range hits {
		if h.ID == actor {
			continue
		}
		_, already := added[h.ID]
		roles := h.Roles
		if roles == nil {
			roles = []string{}
		}
		out = append(out, domain.ContactSearchHit{
			ID: h.ID, DisplayName: h.DisplayName, Roles: roles, City: h.City, AlreadyAdded: already,
		})
		if len(out) >= 10 {
			break
		}
	}
	return out
}

func matchContactFilters(view domain.ContactView, q, role string) bool {
	q = strings.TrimSpace(strings.ToLower(q))
	role = strings.TrimSpace(role)
	if role != "" {
		ok := false
		for _, r := range view.Roles {
			if r == role {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	if q == "" {
		return true
	}
	name := strings.ToLower(view.DisplayName)
	city := strings.ToLower(view.City)
	note := strings.ToLower(view.Note)
	return strings.Contains(name, q) || strings.HasPrefix(name, q) || strings.Contains(city, q) || strings.Contains(note, q)
}

func (s *Service) ListContacts(ctx context.Context, actor uuid.UUID, q, role string, limit, offset int) (*ContactListResult, error) {
	limit, offset = ClampContactPagination(limit, offset)
	rows, totalAll, err := s.store.ListContacts(ctx, actor, q, role, limit, offset)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	views, err := s.hydrateContacts(ctx, actor, rows)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(q) != "" || strings.TrimSpace(role) != "" {
		filtered := make([]domain.ContactView, 0, len(views))
		for _, v := range views {
			if matchContactFilters(v, q, role) {
				filtered = append(filtered, v)
			}
		}
		total := len(filtered)
		start := offset
		if start > total {
			start = total
		}
		end := start + limit
		if end > total {
			end = total
		}
		return &ContactListResult{Items: filtered[start:end], Total: total, Limit: limit, Offset: offset}, nil
	}
	_ = totalAll
	return &ContactListResult{Items: views, Total: totalAll, Limit: limit, Offset: offset}, nil
}

func (s *Service) AddContact(ctx context.Context, in AddContactInput) (*domain.ContactView, bool, error) {
	note, err := NormalizeContactNote(in.Note)
	if err != nil {
		return nil, false, err
	}
	peer, err := s.resolveIdentityUser(ctx, in.UserID, in.Email, in.Phone)
	if err != nil {
		return nil, false, err
	}
	if peer.ID == in.ActorID {
		return nil, false, apperr.Unprocessable(apperr.CodeContactSelf, "cannot add yourself as a contact")
	}
	if existing, err := s.store.GetContactByOwnerPair(ctx, in.ActorID, peer.ID); err != nil {
		return nil, false, apperr.Internal(err)
	} else if existing != nil {
		view, err := s.hydrateOne(ctx, in.ActorID, *existing, peer)
		return view, false, err
	}
	c := domain.Contact{
		ID: ids.New(), OwnerUserID: in.ActorID, ContactUserID: peer.ID,
		Note: note, CreatedAt: s.now().UTC(),
	}
	if err := s.store.InsertContact(ctx, c); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			existing, err := s.store.GetContactByOwnerPair(ctx, in.ActorID, peer.ID)
			if err != nil {
				return nil, false, apperr.Internal(err)
			}
			if existing == nil {
				return nil, false, apperr.Internal(fmt.Errorf("contact conflict without row"))
			}
			view, err := s.hydrateOne(ctx, in.ActorID, *existing, peer)
			return view, false, err
		}
		return nil, false, apperr.Internal(err)
	}
	view, err := s.hydrateOne(ctx, in.ActorID, c, peer)
	return view, true, err
}

func (s *Service) UpdateContactNote(ctx context.Context, actor, id uuid.UUID, note string) (*domain.ContactView, error) {
	note, err := NormalizeContactNote(note)
	if err != nil {
		return nil, err
	}
	c, err := s.store.GetContactForOwner(ctx, id, actor)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if c == nil {
		return nil, apperr.NotFound("contact not found")
	}
	if err := s.store.UpdateContactNote(ctx, id, actor, note); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperr.NotFound("contact not found")
		}
		return nil, apperr.Internal(err)
	}
	c.Note = note
	return s.hydrateOne(ctx, actor, *c, nil)
}

func (s *Service) DeleteContact(ctx context.Context, actor, id uuid.UUID) error {
	if err := s.store.DeleteContact(ctx, id, actor); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.NotFound("contact not found")
		}
		return apperr.Internal(err)
	}
	return nil
}

func (s *Service) SearchContactsDirectory(ctx context.Context, actor uuid.UUID, q string) ([]domain.ContactSearchHit, error) {
	if err := ValidateContactSearchQuery(q); err != nil {
		return nil, err
	}
	hits, err := s.identitySearch(ctx, q, 10)
	if err != nil {
		return nil, err
	}
	ids, err := s.store.ListContactUserIDs(ctx, actor)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	added := make(map[uuid.UUID]struct{}, len(ids))
	for _, id := range ids {
		added[id] = struct{}{}
	}
	return FilterContactSearchHits(actor, added, hits), nil
}

func (s *Service) hydrateContacts(ctx context.Context, actor uuid.UUID, rows []domain.Contact) ([]domain.ContactView, error) {
	if len(rows) == 0 {
		return []domain.ContactView{}, nil
	}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ContactUserID)
	}
	users, err := s.identityBatch(ctx, ids)
	if err != nil {
		return nil, err
	}
	byID := make(map[uuid.UUID]identityPublicUser, len(users))
	for _, u := range users {
		byID[u.ID] = u
	}
	out := make([]domain.ContactView, 0, len(rows))
	for _, r := range rows {
		u := byID[r.ContactUserID]
		if u.ID == uuid.Nil {
			u = identityPublicUser{ID: r.ContactUserID, DisplayName: "Пользователь", Roles: []string{}}
		}
		view, err := s.hydrateOne(ctx, actor, r, &u)
		if err != nil {
			return nil, err
		}
		out = append(out, *view)
	}
	return out, nil
}

func (s *Service) hydrateOne(ctx context.Context, actor uuid.UUID, c domain.Contact, peer *identityPublicUser) (*domain.ContactView, error) {
	var u identityPublicUser
	if peer != nil {
		u = *peer
	} else {
		batch, err := s.identityBatch(ctx, []uuid.UUID{c.ContactUserID})
		if err != nil {
			return nil, err
		}
		if len(batch) > 0 {
			u = batch[0]
		} else {
			u = identityPublicUser{ID: c.ContactUserID, DisplayName: "Пользователь", Roles: []string{}}
		}
	}
	convID, err := s.store.FindConversationBetween(ctx, actor, c.ContactUserID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	roles := u.Roles
	if roles == nil {
		roles = []string{}
	}
	return &domain.ContactView{
		ID: c.ID, UserID: c.ContactUserID, DisplayName: u.DisplayName, Roles: roles,
		City: u.City, AvatarMediaID: nil, Note: c.Note, ConversationID: convID, CreatedAt: c.CreatedAt,
	}, nil
}

func (s *Service) resolveIdentityUser(ctx context.Context, userID *uuid.UUID, email, phone string) (*identityPublicUser, error) {
	if userID == nil && strings.TrimSpace(email) == "" && strings.TrimSpace(phone) == "" {
		return nil, apperr.Validation("user_id, email, or phone is required")
	}
	if s.identityURL == "" || s.internalToken == "" {
		return nil, apperr.Internal(fmt.Errorf("identity is not configured"))
	}
	u, err := url.Parse(s.identityURL + "/v1/internal/users/resolve")
	if err != nil {
		return nil, apperr.Internal(err)
	}
	q := u.Query()
	if userID != nil {
		q.Set("user_id", userID.String())
	}
	if e := strings.TrimSpace(email); e != "" {
		q.Set("email", e)
	}
	if p := strings.TrimSpace(phone); p != "" {
		q.Set("phone", p)
	}
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
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
		return nil, apperr.NotFound("user not found")
	}
	if resp.StatusCode >= 300 {
		return nil, apperr.Internal(fmt.Errorf("identity resolve status %d", resp.StatusCode))
	}
	var body struct {
		ID          string   `json:"id"`
		DisplayName string   `json:"display_name"`
		Roles       []string `json:"roles"`
		City        string   `json:"city"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&body); err != nil {
		return nil, apperr.Internal(err)
	}
	id, err := uuid.Parse(body.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	roles := body.Roles
	if roles == nil {
		roles = []string{}
	}
	return &identityPublicUser{ID: id, DisplayName: body.DisplayName, Roles: roles, City: body.City}, nil
}

func (s *Service) identitySearch(ctx context.Context, q string, limit int) ([]identityPublicUser, error) {
	if s.identityURL == "" || s.internalToken == "" {
		return nil, apperr.Internal(fmt.Errorf("identity is not configured"))
	}
	u, err := url.Parse(s.identityURL + "/v1/internal/users/search")
	if err != nil {
		return nil, apperr.Internal(err)
	}
	query := u.Query()
	query.Set("q", q)
	query.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, apperr.Internal(fmt.Errorf("identity search status %d", resp.StatusCode))
	}
	var body struct {
		Items []struct {
			ID          string   `json:"id"`
			DisplayName string   `json:"display_name"`
			Roles       []string `json:"roles"`
			City        string   `json:"city"`
		} `json:"items"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return nil, apperr.Internal(err)
	}
	out := make([]identityPublicUser, 0, len(body.Items))
	for _, it := range body.Items {
		id, err := uuid.Parse(it.ID)
		if err != nil {
			continue
		}
		roles := it.Roles
		if roles == nil {
			roles = []string{}
		}
		out = append(out, identityPublicUser{ID: id, DisplayName: it.DisplayName, Roles: roles, City: it.City})
	}
	return out, nil
}

func (s *Service) identityBatch(ctx context.Context, ids []uuid.UUID) ([]identityPublicUser, error) {
	if len(ids) == 0 {
		return []identityPublicUser{}, nil
	}
	if s.identityURL == "" || s.internalToken == "" {
		return nil, apperr.Internal(fmt.Errorf("identity is not configured"))
	}
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		parts = append(parts, id.String())
	}
	u, err := url.Parse(s.identityURL + "/v1/internal/users/batch")
	if err != nil {
		return nil, apperr.Internal(err)
	}
	q := u.Query()
	q.Set("ids", strings.Join(parts, ","))
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, apperr.Internal(fmt.Errorf("identity batch status %d", resp.StatusCode))
	}
	var body struct {
		Items []struct {
			ID          string   `json:"id"`
			DisplayName string   `json:"display_name"`
			Roles       []string `json:"roles"`
			City        string   `json:"city"`
		} `json:"items"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return nil, apperr.Internal(err)
	}
	out := make([]identityPublicUser, 0, len(body.Items))
	for _, it := range body.Items {
		id, err := uuid.Parse(it.ID)
		if err != nil {
			continue
		}
		roles := it.Roles
		if roles == nil {
			roles = []string{}
		}
		out = append(out, identityPublicUser{ID: id, DisplayName: it.DisplayName, Roles: roles, City: it.City})
	}
	return out, nil
}
