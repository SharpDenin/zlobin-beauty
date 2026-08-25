package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

func (s *Service) WithClients(clientsURL string) *Service {
	s.clientsURL = strings.TrimRight(clientsURL, "/")
	return s
}

func (s *Service) WithCommunications(communicationsURL string) *Service {
	s.communicationsURL = strings.TrimRight(communicationsURL, "/")
	return s
}

type UpsertMasterclassInput struct {
	ActorID      uuid.UUID
	ID           *uuid.UUID
	Title        string
	Description  string
	Category     string
	City         string
	LocationNote string
	StartsAt     time.Time
	EndsAt       time.Time
	Timezone     string
	Capacity     int
}

func (s *Service) requirePublishedMaster(ctx context.Context, userID uuid.UUID) error {
	m, err := s.GetMasterByUserID(ctx, userID)
	if err != nil {
		return err
	}
	if !m.Published {
		return apperr.Forbidden("master profile must be published")
	}
	return nil
}

func (s *Service) CreateMasterclass(ctx context.Context, in UpsertMasterclassInput) (*domain.MasterclassEvent, error) {
	if err := s.requirePublishedMaster(ctx, in.ActorID); err != nil {
		return nil, err
	}
	e, err := buildMasterclass(in, in.ActorID, s.now().UTC())
	if err != nil {
		return nil, err
	}
	e.ID = ids.New()
	e.Status = domain.StatusDraft
	if err := s.store.InsertMasterclass(ctx, *e); err != nil {
		return nil, apperr.Internal(err)
	}
	return s.GetMasterclass(ctx, e.ID, in.ActorID)
}

func (s *Service) PatchMasterclass(ctx context.Context, in UpsertMasterclassInput) (*domain.MasterclassEvent, error) {
	if in.ID == nil {
		return nil, apperr.Validation("id is required")
	}
	existing, err := s.store.GetMasterclass(ctx, *in.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if existing == nil {
		return nil, apperr.NotFound("masterclass not found")
	}
	if existing.InstructorUserID != in.ActorID {
		return nil, apperr.Forbidden("not allowed")
	}
	if existing.Status != domain.StatusDraft {
		return nil, apperr.Conflict("only draft masterclass can be edited")
	}
	e, err := buildMasterclass(in, in.ActorID, s.now().UTC())
	if err != nil {
		return nil, err
	}
	e.ID = existing.ID
	e.CreatedAt = existing.CreatedAt
	e.Status = existing.Status
	if err := s.store.UpdateMasterclass(ctx, *e); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return s.GetMasterclass(ctx, e.ID, in.ActorID)
}

func (s *Service) PublishMasterclass(ctx context.Context, id, actor uuid.UUID) (*domain.MasterclassEvent, error) {
	existing, err := s.store.GetMasterclass(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if existing == nil {
		return nil, apperr.NotFound("masterclass not found")
	}
	if existing.InstructorUserID != actor {
		return nil, apperr.Forbidden("not allowed")
	}
	if existing.Status != domain.StatusDraft && existing.Status != domain.StatusPublished {
		return nil, apperr.Conflict("cannot publish this masterclass")
	}
	existing.Status = domain.StatusPublished
	existing.UpdatedAt = s.now().UTC()
	if err := s.store.UpdateMasterclass(ctx, *existing); err != nil {
		return nil, apperr.Internal(err)
	}
	s.notifyMasterclassMatches(ctx, *existing)
	return s.GetMasterclass(ctx, id, actor)
}

func (s *Service) GetMasterclass(ctx context.Context, id, actor uuid.UUID) (*domain.MasterclassEvent, error) {
	e, err := s.store.GetMasterclass(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if e == nil {
		return nil, apperr.NotFound("masterclass not found")
	}
	if e.Status != domain.StatusPublished && e.InstructorUserID != actor {
		return nil, apperr.Forbidden("not allowed")
	}
	n, err := s.store.CountConfirmedRegistrations(ctx, e.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	e.RegisteredCount = n
	e.InstructorName = e.InstructorUserID.String()
	if m, err := s.store.GetMasterByUser(ctx, e.InstructorUserID); err == nil && m != nil {
		e.InstructorName = m.DisplayName
	}
	s.markMasterclassRelevance(ctx, actor, e)
	return e, nil
}

func (s *Service) ListMasterclasses(ctx context.Context, actor uuid.UUID, mine bool, limit, offset int) ([]domain.MasterclassEvent, error) {
	var instructor *uuid.UUID
	publishedOnly := true
	if mine {
		instructor = &actor
		publishedOnly = false
	}
	items, err := s.store.ListMasterclasses(ctx, instructor, publishedOnly, limit, offset)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	out := make([]domain.MasterclassEvent, 0, len(items))
	for i := range items {
		n, err := s.store.CountConfirmedRegistrations(ctx, items[i].ID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		items[i].RegisteredCount = n
		if m, err := s.store.GetMasterByUser(ctx, items[i].InstructorUserID); err == nil && m != nil {
			items[i].InstructorName = m.DisplayName
		}
		s.markMasterclassRelevance(ctx, actor, &items[i])
		out = append(out, items[i])
	}
	return out, nil
}

func (s *Service) markMasterclassRelevance(ctx context.Context, actor uuid.UUID, e *domain.MasterclassEvent) {
	if e.InstructorUserID == actor {
		return
	}
	interests, err := s.store.ListInterests(ctx, &actor, true)
	if err != nil {
		return
	}
	best := 0
	for _, in := range interests {
		score := MatchScore(e.Category, in.Category, e.City, in.City, e.StartsAt, e.EndsAt, in.DateFrom, in.DateTo)
		if score > best {
			best = score
		}
	}
	e.MatchScore = best
	e.Relevant = best > 0
}

func (s *Service) CreateInterest(ctx context.Context, actor uuid.UUID, category, city, location string, from, to time.Time) (*domain.MasterclassInterest, error) {
	if err := s.requirePublishedMaster(ctx, actor); err != nil {
		return nil, err
	}
	category = strings.TrimSpace(category)
	city = strings.TrimSpace(city)
	if category == "" || city == "" {
		return nil, apperr.Validation("category and city are required")
	}
	if to.Before(from) {
		return nil, apperr.Validation("date_to must be on or after date_from")
	}
	i := domain.MasterclassInterest{
		ID: ids.New(), MasterUserID: actor, Category: category, City: city,
		DateFrom: dateUTC(from), DateTo: dateUTC(to), LocationNote: strings.TrimSpace(location),
		Status: "active", CreatedAt: s.now().UTC(),
	}
	if err := s.store.InsertInterest(ctx, i); err != nil {
		return nil, apperr.Internal(err)
	}
	s.notifyInterestMatches(ctx, i)
	return &i, nil
}

func (s *Service) ListInterests(ctx context.Context, actor uuid.UUID, all bool) ([]domain.MasterclassInterest, error) {
	var user *uuid.UUID
	if !all {
		user = &actor
	}
	items, err := s.store.ListInterests(ctx, user, true)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.MasterclassInterest{}
	}
	return items, nil
}

func (s *Service) MatchingInterests(ctx context.Context, eventID, actor uuid.UUID) ([]domain.MasterclassInterest, error) {
	e, err := s.GetMasterclass(ctx, eventID, actor)
	if err != nil {
		return nil, err
	}
	if e.InstructorUserID != actor {
		return nil, apperr.Forbidden("not allowed")
	}
	items, err := s.store.ListInterests(ctx, nil, true)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	var out []domain.MasterclassInterest
	for _, in := range items {
		if in.MasterUserID == actor {
			continue
		}
		score := MatchScore(e.Category, in.Category, e.City, in.City, e.StartsAt, e.EndsAt, in.DateFrom, in.DateTo)
		if score == 0 {
			continue
		}
		in.MatchScore = score
		out = append(out, in)
	}
	return out, nil
}

func (s *Service) RegisterMasterclass(ctx context.Context, eventID, actor uuid.UUID) (*domain.MasterclassRegistration, error) {
	if err := s.requirePublishedMaster(ctx, actor); err != nil {
		return nil, err
	}
	var last error
	for i := 0; i < 4; i++ {
		reg, err := s.store.RegisterMasterclass(ctx, eventID, actor, ids.New(), s.now().UTC())
		if err == nil {
			e, _ := s.store.GetMasterclass(ctx, eventID)
			if e != nil {
				s.notify(ctx, e.InstructorUserID, "masterclass_registration", "Новая запись на мастер-класс", e.Title, "masterclass", eventID)
			}
			return reg, nil
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
	return nil, apperr.Internal(fmt.Errorf("register failed"))
}

func (s *Service) CancelRegistration(ctx context.Context, id, actor uuid.UUID) error {
	err := s.store.CancelRegistration(ctx, id, actor, s.now().UTC())
	if ae, ok := apperr.As(err); ok {
		return ae
	}
	if err != nil {
		return apperr.Internal(err)
	}
	return nil
}

func (s *Service) ListRegistrations(ctx context.Context, eventID, actor uuid.UUID) ([]domain.MasterclassRegistration, error) {
	e, err := s.store.GetMasterclass(ctx, eventID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if e == nil {
		return nil, apperr.NotFound("masterclass not found")
	}
	if e.InstructorUserID != actor {
		mine, err := s.store.GetRegistration(ctx, eventID, actor)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if mine == nil {
			return nil, apperr.Forbidden("not allowed")
		}
		return []domain.MasterclassRegistration{*mine}, nil
	}
	items, err := s.store.ListRegistrations(ctx, eventID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.MasterclassRegistration{}
	}
	return items, nil
}

func (s *Service) MasterclassAccess(ctx context.Context, eventID, actor, peer uuid.UUID) (instructor uuid.UUID, allowed bool, err error) {
	e, err := s.store.GetMasterclass(ctx, eventID)
	if err != nil {
		return uuid.Nil, false, apperr.Internal(err)
	}
	if e == nil {
		return uuid.Nil, false, apperr.NotFound("masterclass not found")
	}
	regActor, err := s.store.GetRegistration(ctx, eventID, actor)
	if err != nil {
		return uuid.Nil, false, apperr.Internal(err)
	}
	regPeer, err := s.store.GetRegistration(ctx, eventID, peer)
	if err != nil {
		return uuid.Nil, false, apperr.Internal(err)
	}
	actorOK := actor == e.InstructorUserID || (regActor != nil && regActor.Status != domain.RegCancelled)
	peerOK := peer == e.InstructorUserID || (regPeer != nil && regPeer.Status != domain.RegCancelled)
	instructorPair := (actor == e.InstructorUserID && peerOK) || (peer == e.InstructorUserID && actorOK)
	return e.InstructorUserID, instructorPair && actor != peer, nil
}

func (s *Service) notifyMasterclassMatches(ctx context.Context, e domain.MasterclassEvent) {
	items, err := s.store.ListInterests(ctx, nil, true)
	if err != nil {
		return
	}
	seen := map[uuid.UUID]struct{}{}
	for _, in := range items {
		if in.MasterUserID == e.InstructorUserID {
			continue
		}
		if _, ok := seen[in.MasterUserID]; ok {
			continue
		}
		if MatchScore(e.Category, in.Category, e.City, in.City, e.StartsAt, e.EndsAt, in.DateFrom, in.DateTo) == 0 {
			continue
		}
		seen[in.MasterUserID] = struct{}{}
		s.notify(ctx, in.MasterUserID, "masterclass_match", "Подходящий мастер-класс", e.Title, "masterclass", e.ID)
	}
}

func (s *Service) notifyInterestMatches(ctx context.Context, in domain.MasterclassInterest) {
	items, err := s.store.ListMasterclasses(ctx, nil, true, 100, 0)
	if err != nil {
		return
	}
	seen := map[uuid.UUID]struct{}{}
	for _, e := range items {
		if e.InstructorUserID == in.MasterUserID {
			continue
		}
		if MatchScore(e.Category, in.Category, e.City, in.City, e.StartsAt, e.EndsAt, in.DateFrom, in.DateTo) == 0 {
			continue
		}
		if _, ok := seen[e.InstructorUserID]; ok {
			continue
		}
		seen[e.InstructorUserID] = struct{}{}
		s.notify(ctx, e.InstructorUserID, "masterclass_interest", "Есть интерес к мастер-классу", in.Category, "masterclass", e.ID)
	}
}

func buildMasterclass(in UpsertMasterclassInput, actor uuid.UUID, now time.Time) (*domain.MasterclassEvent, error) {
	title := strings.TrimSpace(in.Title)
	category := strings.TrimSpace(in.Category)
	city := strings.TrimSpace(in.City)
	if title == "" || category == "" || city == "" {
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
	return &domain.MasterclassEvent{
		InstructorUserID: actor, Title: title, Description: strings.TrimSpace(in.Description),
		Category: category, City: city, LocationNote: strings.TrimSpace(in.LocationNote),
		StartsAt: in.StartsAt.UTC(), EndsAt: in.EndsAt.UTC(), Timezone: tz, Capacity: in.Capacity,
		CreatedAt: now, UpdatedAt: now,
	}, nil
}

func dateUTC(t time.Time) time.Time {
	u := t.UTC()
	return time.Date(u.Year(), u.Month(), u.Day(), 0, 0, 0, 0, time.UTC)
}

func (s *Service) notify(ctx context.Context, userID uuid.UUID, typ, title, body, entityType string, entityID uuid.UUID) {
	if s.communicationsURL == "" || s.internalToken == "" {
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"user_id": userID.String(), "type": typ, "title": title, "body": body,
		"entity_type": entityType, "entity_id": entityID.String(),
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.communicationsURL+"/v1/internal/notifications", strings.NewReader(string(payload)))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return
	}
	_ = resp.Body.Close()
}
