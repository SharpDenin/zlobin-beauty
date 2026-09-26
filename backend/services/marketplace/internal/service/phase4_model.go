package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type UpsertModelRequestInput struct {
	ActorID      uuid.UUID
	ID           *uuid.UUID
	Category     string
	Title        string
	Description  string
	City         string
	LocationNote string
	StartsAt     time.Time
	EndsAt       time.Time
	Timezone     string
	Capacity     int
}

func (s *Service) CreateModelRequest(ctx context.Context, in UpsertModelRequestInput) (*domain.ModelRequest, error) {
	if err := s.requirePublishedMaster(ctx, in.ActorID); err != nil {
		return nil, err
	}
	e, err := buildModelRequest(in, in.ActorID, s.now().UTC())
	if err != nil {
		return nil, err
	}
	e.ID = ids.New()
	e.Status = domain.StatusDraft
	if err := s.store.InsertModelRequest(ctx, *e); err != nil {
		return nil, apperr.Internal(err)
	}
	return s.GetModelRequest(ctx, e.ID, in.ActorID)
}

func (s *Service) PatchModelRequest(ctx context.Context, in UpsertModelRequestInput) (*domain.ModelRequest, error) {
	if in.ID == nil {
		return nil, apperr.Validation("id is required")
	}
	existing, err := s.store.GetModelRequest(ctx, *in.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if existing == nil {
		return nil, apperr.NotFound("model request not found")
	}
	if existing.MasterUserID != in.ActorID {
		return nil, apperr.Forbidden("not allowed")
	}
	if existing.Status != domain.StatusDraft {
		return nil, apperr.Conflict("only draft request can be edited")
	}
	e, err := buildModelRequest(in, in.ActorID, s.now().UTC())
	if err != nil {
		return nil, err
	}
	e.ID = existing.ID
	e.CreatedAt = existing.CreatedAt
	e.Status = existing.Status
	e.AcceptedCount = existing.AcceptedCount
	if err := s.store.UpdateModelRequest(ctx, *e); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return s.GetModelRequest(ctx, e.ID, in.ActorID)
}

func (s *Service) PublishModelRequest(ctx context.Context, id, actor uuid.UUID) (*domain.ModelRequest, error) {
	existing, err := s.store.GetModelRequest(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if existing == nil {
		return nil, apperr.NotFound("model request not found")
	}
	if existing.MasterUserID != actor {
		return nil, apperr.Forbidden("not allowed")
	}
	if existing.Status != domain.StatusDraft && existing.Status != domain.StatusPublished {
		return nil, apperr.Conflict("cannot publish this request")
	}
	existing.Status = domain.StatusPublished
	existing.UpdatedAt = s.now().UTC()
	if err := s.store.UpdateModelRequest(ctx, *existing); err != nil {
		return nil, apperr.Internal(err)
	}
	s.notifyModelMatches(ctx, *existing)
	return s.GetModelRequest(ctx, id, actor)
}

func (s *Service) GetModelRequest(ctx context.Context, id, actor uuid.UUID) (*domain.ModelRequest, error) {
	e, err := s.store.GetModelRequest(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if e == nil {
		return nil, apperr.NotFound("model request not found")
	}
	if e.MasterUserID != actor {
		public := e.Status == domain.StatusPublished
		mine, err := s.store.GetModelResponse(ctx, e.ID, actor)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if !public && mine == nil {
			return nil, apperr.Forbidden("not allowed")
		}
	}
	if m, err := s.store.GetMasterByUser(ctx, e.MasterUserID); err == nil && m != nil {
		e.MasterName = m.DisplayName
	}
	if resp, err := s.store.GetModelResponse(ctx, e.ID, actor); err == nil {
		e.MyResponse = resp
	}
	s.markModelRelevance(ctx, actor, e)
	return e, nil
}

func (s *Service) ListModelRequests(ctx context.Context, actor uuid.UUID, mine bool, limit, offset int) ([]domain.ModelRequest, error) {
	var master *uuid.UUID
	publishedOnly := true
	if mine {
		master = &actor
		publishedOnly = false
	}
	items, err := s.store.ListModelRequests(ctx, master, publishedOnly, limit, offset)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	out := make([]domain.ModelRequest, 0, len(items))
	for i := range items {
		if m, err := s.store.GetMasterByUser(ctx, items[i].MasterUserID); err == nil && m != nil {
			items[i].MasterName = m.DisplayName
		}
		if resp, err := s.store.GetModelResponse(ctx, items[i].ID, actor); err == nil {
			items[i].MyResponse = resp
		}
		s.markModelRelevance(ctx, actor, &items[i])
		out = append(out, items[i])
	}
	return out, nil
}

func (s *Service) markModelRelevance(ctx context.Context, actor uuid.UUID, e *domain.ModelRequest) {
	if e.MasterUserID == actor {
		return
	}
	pref, err := s.fetchModelPreference(ctx, actor)
	if err != nil || pref == nil || !pref.Willing {
		return
	}
	best := 0
	for _, cat := range pref.Categories {
		from, to := pref.DateFrom, pref.DateTo
		if from.IsZero() || to.IsZero() {
			from, to = e.StartsAt, e.EndsAt
		}
		city := pref.City
		if city == "" {
			city = e.City
		}
		score := MatchScore(e.Category, cat, e.City, city, e.StartsAt, e.EndsAt, from, to)
		if score > best {
			best = score
		}
	}
	e.MatchScore = best
	e.Relevant = best > 0
}

func (s *Service) RespondModelRequest(ctx context.Context, requestID, actor uuid.UUID) (*domain.ModelResponse, error) {
	e, err := s.store.GetModelRequest(ctx, requestID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if e == nil || e.Status != domain.StatusPublished {
		return nil, apperr.NotFound("model request not found")
	}
	if e.MasterUserID == actor {
		return nil, apperr.Forbidden("cannot respond to own request")
	}
	existing, err := s.store.GetModelResponse(ctx, requestID, actor)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if existing != nil && existing.Status != domain.RespCancelled {
		return nil, apperr.Conflict("already responded")
	}
	now := s.now().UTC()
	r := domain.ModelResponse{
		ID: ids.New(), RequestID: requestID, ClientUserID: actor, Status: domain.RespRequested, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.store.InsertModelResponse(ctx, r); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	s.notify(ctx, e.MasterUserID, "model_response", "Отклик на запрос модели", e.Title, "model_request", e.ID)
	return &r, nil
}

func (s *Service) AcceptModelResponse(ctx context.Context, responseID, actor uuid.UUID) (*domain.ModelRequest, error) {
	var last error
	for i := 0; i < 4; i++ {
		req, err := s.store.AcceptModelResponse(ctx, responseID, actor, s.now().UTC())
		if err == nil {
			if req != nil {
				s.notify(ctx, req.MasterUserID, "model_accepted", "Модель подтвердила слот", req.Title, "model_request", req.ID)
			}
			return req, nil
		}
		if ae, ok := apperr.As(err); ok && ae.Message == "retry" {
			last = err
			continue
		}
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	if last != nil {
		return nil, apperr.Conflict("please retry")
	}
	return nil, apperr.Internal(fmt.Errorf("accept failed"))
}

func (s *Service) CancelModelResponse(ctx context.Context, id, actor uuid.UUID) error {
	err := s.store.CancelModelResponse(ctx, id, actor, s.now().UTC())
	if ae, ok := apperr.As(err); ok {
		return ae
	}
	if err != nil {
		return apperr.Internal(err)
	}
	return nil
}

func (s *Service) ListModelResponses(ctx context.Context, requestID, actor uuid.UUID) ([]domain.ModelResponse, error) {
	e, err := s.store.GetModelRequest(ctx, requestID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if e == nil {
		return nil, apperr.NotFound("model request not found")
	}
	if e.MasterUserID != actor {
		mine, err := s.store.GetModelResponse(ctx, requestID, actor)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if mine == nil {
			return nil, apperr.Forbidden("not allowed")
		}
		return []domain.ModelResponse{*mine}, nil
	}
	items, err := s.store.ListModelResponses(ctx, requestID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.ModelResponse{}
	}
	return items, nil
}

func (s *Service) ModelRequestAccess(ctx context.Context, requestID, actor, peer uuid.UUID) (bool, error) {
	e, err := s.store.GetModelRequest(ctx, requestID)
	if err != nil {
		return false, apperr.Internal(err)
	}
	if e == nil {
		return false, apperr.NotFound("model request not found")
	}
	respActor, _ := s.store.GetModelResponse(ctx, requestID, actor)
	respPeer, _ := s.store.GetModelResponse(ctx, requestID, peer)
	actorOK := actor == e.MasterUserID || (respActor != nil && respActor.Status != domain.RespCancelled)
	peerOK := peer == e.MasterUserID || (respPeer != nil && respPeer.Status != domain.RespCancelled)
	return actorOK && peerOK && actor != peer && (actor == e.MasterUserID || peer == e.MasterUserID), nil
}

type clientPref struct {
	Willing    bool
	Notify     bool
	Categories []string
	City       string
	DateFrom   time.Time
	DateTo     time.Time
}

func (s *Service) fetchModelPreference(ctx context.Context, userID uuid.UUID) (*clientPref, error) {
	if s.clientsURL == "" || s.internalToken == "" {
		return nil, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.clientsURL+"/v1/internal/model-preferences/"+userID.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("clients status %d", resp.StatusCode)
	}
	var body struct {
		Willing    bool     `json:"willing"`
		Notify     bool     `json:"notify"`
		Categories []string `json:"categories"`
		City       string   `json:"city"`
		DateFrom   *string  `json:"date_from"`
		DateTo     *string  `json:"date_to"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&body); err != nil {
		return nil, err
	}
	p := &clientPref{Willing: body.Willing, Notify: body.Notify, Categories: body.Categories, City: body.City}
	if body.DateFrom != nil && *body.DateFrom != "" {
		if t, err := time.Parse("2006-01-02", *body.DateFrom); err == nil {
			p.DateFrom = t
		}
	}
	if body.DateTo != nil && *body.DateTo != "" {
		if t, err := time.Parse("2006-01-02", *body.DateTo); err == nil {
			p.DateTo = t
		}
	}
	return p, nil
}

func (s *Service) notifyModelMatches(ctx context.Context, e domain.ModelRequest) {
	if s.clientsURL == "" || s.internalToken == "" {
		return
	}
	u, _ := url.Parse(s.clientsURL + "/v1/internal/model-preferences/matches")
	q := u.Query()
	q.Set("category", e.Category)
	q.Set("city", e.City)
	q.Set("date", e.StartsAt.UTC().Format("2006-01-02"))
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return
	}
	var body struct {
		Items []struct {
			UserID string `json:"user_id"`
		} `json:"items"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return
	}
	for _, it := range body.Items {
		uid, err := uuid.Parse(it.UserID)
		if err != nil || uid == e.MasterUserID {
			continue
		}
		s.notify(ctx, uid, "model_opportunity", "Предложение стать моделью", e.Title, "model_request", e.ID)
	}
}

func buildModelRequest(in UpsertModelRequestInput, actor uuid.UUID, now time.Time) (*domain.ModelRequest, error) {
	category := strings.TrimSpace(in.Category)
	title := strings.TrimSpace(in.Title)
	city := strings.TrimSpace(in.City)
	if category == "" || title == "" || city == "" {
		return nil, apperr.Validation("title, category and city are required")
	}
	if !in.EndsAt.After(in.StartsAt) {
		return nil, apperr.Validation("ends_at must be after starts_at")
	}
	if in.Capacity < 1 {
		return nil, apperr.Validation("capacity must be >= 1")
	}
	tz := strings.TrimSpace(in.Timezone)
	if tz == "" {
		tz = "Asia/Krasnoyarsk"
	}
	return &domain.ModelRequest{
		MasterUserID: actor, Category: category, Title: title, Description: strings.TrimSpace(in.Description),
		City: city, LocationNote: strings.TrimSpace(in.LocationNote),
		StartsAt: in.StartsAt.UTC(), EndsAt: in.EndsAt.UTC(), Timezone: tz, Capacity: in.Capacity,
		CreatedAt: now, UpdatedAt: now,
	}, nil
}
