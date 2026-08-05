package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type Service struct {
	store              *store.Store
	marketplaceURL     string
	organizationsURL   string
	clientsURL         string
	communicationsURL  string
	internalToken      string
	httpClient         *http.Client
	now                func() time.Time
}

func New(st *store.Store, marketplaceURL string) *Service {
	return &Service{
		store:          st,
		marketplaceURL: strings.TrimRight(marketplaceURL, "/"),
		httpClient:     &http.Client{Timeout: 5 * time.Second},
		now:            time.Now,
	}
}

func (s *Service) WithIntegrations(organizationsURL, clientsURL, communicationsURL, internalToken string) *Service {
	s.organizationsURL = strings.TrimRight(organizationsURL, "/")
	s.clientsURL = strings.TrimRight(clientsURL, "/")
	s.communicationsURL = strings.TrimRight(communicationsURL, "/")
	s.internalToken = internalToken
	return s
}

func (s *Service) FreeSlots(ctx context.Context, masterUserID uuid.UUID, day time.Time, durationMinutes int, timezone string) ([]Slot, error) {
	if durationMinutes <= 0 {
		return nil, apperr.Validation("duration_minutes must be positive")
	}
	if timezone == "" {
		timezone = "Europe/Moscow"
	}
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		return nil, apperr.Validation("invalid timezone")
	}
	localDay := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, loc)
	weekday := int(localDay.Weekday())
	fromUTC := localDay.UTC()
	toUTC := localDay.Add(24 * time.Hour).UTC()
	hours, err := s.store.ListWorkingHours(ctx, masterUserID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	existing, err := s.store.ListAppointmentsInRange(ctx, masterUserID, fromUTC, toUTC)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	var slots []Slot
	step := 30
	now := s.now().UTC()
	for _, h := range hours {
		if h.Weekday != weekday {
			continue
		}
		for start := h.StartMinute; start+durationMinutes <= h.EndMinute; start += step {
			st := localDay.Add(time.Duration(start) * time.Minute).UTC()
			en := st.Add(time.Duration(durationMinutes) * time.Minute)
			if !st.After(now) {
				continue
			}
			overlap := false
			for _, a := range existing {
				if st.Before(a.EndsAt) && en.After(a.StartsAt) {
					overlap = true
					break
				}
			}
			if !overlap {
				slots = append(slots, Slot{StartsAt: st, EndsAt: en})
			}
		}
	}
	if slots == nil {
		slots = []Slot{}
	}
	return slots, nil
}

const defaultTimezone = "Europe/Moscow"

// ResolveTimezone determines which IANA timezone to use for a master's
// working-hours calculations. Explicit tzParam wins; otherwise we look up
// the master's branch via marketplace and its timezone via organizations;
// falling back to Europe/Moscow when nothing else is available.
func (s *Service) ResolveTimezone(ctx context.Context, masterUserID uuid.UUID, tzParam string) (string, error) {
	tz := strings.TrimSpace(tzParam)
	if tz != "" {
		if _, err := time.LoadLocation(tz); err != nil {
			return "", apperr.Validation("invalid timezone")
		}
		return tz, nil
	}
	if s.marketplaceURL != "" && s.organizationsURL != "" {
		if branchID, ok := s.fetchMasterBranchID(ctx, masterUserID); ok {
			if name, ok := s.fetchBranchTimezone(ctx, branchID); ok {
				return name, nil
			}
		}
	}
	return defaultTimezone, nil
}

func (s *Service) timezoneForBranch(ctx context.Context, branchID uuid.UUID) string {
	if s.organizationsURL == "" {
		return defaultTimezone
	}
	if name, ok := s.fetchBranchTimezone(ctx, branchID); ok {
		return name
	}
	return defaultTimezone
}

type masterByUserPayload struct {
	BranchID *string `json:"branch_id"`
}

func (s *Service) fetchMasterBranchID(ctx context.Context, masterUserID uuid.UUID) (uuid.UUID, bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.marketplaceURL+"/v1/masters/by-user/"+masterUserID.String(), nil)
	if err != nil {
		return uuid.Nil, false
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return uuid.Nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return uuid.Nil, false
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var payload masterByUserPayload
	if err := json.Unmarshal(body, &payload); err != nil || payload.BranchID == nil {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(*payload.BranchID)
	if err != nil {
		return uuid.Nil, false
	}
	return id, true
}

func (s *Service) fetchBranchTimezone(ctx context.Context, branchID uuid.UUID) (string, bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.organizationsURL+"/v1/branches/"+branchID.String(), nil)
	if err != nil {
		return "", false
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", false
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var payload struct {
		Timezone string `json:"timezone"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || payload.Timezone == "" {
		return "", false
	}
	if _, err := time.LoadLocation(payload.Timezone); err != nil {
		return "", false
	}
	return payload.Timezone, true
}

type HoursInput struct {
	Weekday     int `json:"weekday"`
	StartMinute int `json:"start_minute"`
	EndMinute   int `json:"end_minute"`
}

func (s *Service) SetWorkingHours(ctx context.Context, masterUserID uuid.UUID, inputs []HoursInput) ([]domain.WorkingHours, error) {
	if len(inputs) == 0 {
		return nil, apperr.Validation("at least one working interval is required")
	}
	hours := make([]domain.WorkingHours, 0, len(inputs))
	for _, in := range inputs {
		if in.Weekday < 0 || in.Weekday > 6 {
			return nil, apperr.Validation("weekday must be 0-6 (Sunday-Saturday)")
		}
		if in.StartMinute < 0 || in.EndMinute > 1440 || in.EndMinute <= in.StartMinute {
			return nil, apperr.Validation("invalid working interval")
		}
		hours = append(hours, domain.WorkingHours{
			ID: ids.New(), MasterUserID: masterUserID, Weekday: in.Weekday, StartMinute: in.StartMinute, EndMinute: in.EndMinute,
		})
	}
	if err := s.store.ReplaceWorkingHours(ctx, masterUserID, hours); err != nil {
		return nil, apperr.Internal(err)
	}
	return hours, nil
}

func (s *Service) GetWorkingHours(ctx context.Context, masterUserID uuid.UUID) ([]domain.WorkingHours, error) {
	hours, err := s.store.ListWorkingHours(ctx, masterUserID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if hours == nil {
		hours = []domain.WorkingHours{}
	}
	return hours, nil
}

type Slot struct {
	StartsAt time.Time `json:"starts_at"`
	EndsAt   time.Time `json:"ends_at"`
}

type CreateInput struct {
	ClientUserID uuid.UUID
	MasterID     uuid.UUID
	ServiceID    uuid.UUID
	StartsAt     time.Time
}

type masterPayload struct {
	Master struct {
		ID             string  `json:"id"`
		UserID         string  `json:"user_id"`
		OrganizationID string  `json:"organization_id"`
		BranchID       *string `json:"branch_id"`
		Published      bool    `json:"published"`
	} `json:"master"`
	Services []struct {
		ID              string `json:"id"`
		Name            string `json:"name"`
		DurationMinutes int    `json:"duration_minutes"`
		PriceMinor      int64  `json:"price_minor"`
		Currency        string `json:"currency"`
	} `json:"services"`
}

func (s *Service) Create(ctx context.Context, in CreateInput) (*domain.Appointment, error) {
	if in.StartsAt.Before(s.now().UTC()) {
		return nil, apperr.Validation("starts_at must be in the future")
	}
	payload, err := s.fetchMaster(ctx, in.MasterID)
	if err != nil {
		return nil, err
	}
	if !payload.Master.Published {
		return nil, apperr.NotFound("master not found")
	}
	masterUserID, err := uuid.Parse(payload.Master.UserID)
	if err != nil {
		return nil, apperr.Internal(fmt.Errorf("bad master user id"))
	}
	orgID, err := uuid.Parse(payload.Master.OrganizationID)
	if err != nil {
		return nil, apperr.Internal(fmt.Errorf("bad org id"))
	}
	if payload.Master.BranchID == nil {
		return nil, apperr.Validation("master has no branch")
	}
	branchID, err := uuid.Parse(*payload.Master.BranchID)
	if err != nil {
		return nil, apperr.Validation("invalid master branch")
	}
	var svcName string
	var duration int
	var price int64
	currency := "RUB"
	found := false
	for _, svc := range payload.Services {
		if svc.ID == in.ServiceID.String() {
			found = true
			svcName = svc.Name
			duration = svc.DurationMinutes
			price = svc.PriceMinor
			currency = svc.Currency
			break
		}
	}
	if !found {
		return nil, apperr.Validation("service is not offered by master")
	}
	ends := in.StartsAt.UTC().Add(time.Duration(duration) * time.Minute)
	slots, err := s.FreeSlots(ctx, masterUserID, in.StartsAt, duration, s.timezoneForBranch(ctx, branchID))
	if err != nil {
		return nil, err
	}
	okSlot := false
	for _, slot := range slots {
		if slot.StartsAt.Equal(in.StartsAt.UTC()) {
			okSlot = true
			break
		}
	}
	if !okSlot {
		return nil, apperr.Conflict("selected time is not available")
	}
	now := s.now().UTC()
	a := domain.Appointment{
		ID: ids.New(), OrganizationID: orgID, BranchID: branchID, MasterUserID: masterUserID,
		ClientUserID: in.ClientUserID, ServiceID: in.ServiceID, ServiceName: svcName,
		DurationMinutes: duration, PriceMinor: price, Currency: currency,
		Status: domain.StatusPendingConfirmation, StartsAt: in.StartsAt.UTC(), EndsAt: ends,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := s.store.CreateAppointment(ctx, a); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	s.notify(ctx, a.MasterUserID, "appointment.created", "Новая запись", a.ServiceName, a.ID)
	s.notify(ctx, a.ClientUserID, "appointment.created", "Запись создана", "Ожидает подтверждения мастера", a.ID)
	return &a, nil
}

func (s *Service) Confirm(ctx context.Context, appointmentID, actorUserID uuid.UUID) (*domain.Appointment, error) {
	return s.changeStatus(ctx, appointmentID, actorUserID, domain.StatusConfirmed, "", func(a *domain.Appointment) error {
		if a.MasterUserID != actorUserID {
			return apperr.Forbidden("only assigned master can confirm")
		}
		return domain.Transition(a.Status, domain.StatusConfirmed)
	})
}

func (s *Service) Cancel(ctx context.Context, appointmentID, actorUserID uuid.UUID, reason string) (*domain.Appointment, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil, apperr.Validation("reason is required")
	}
	a, err := s.store.GetAppointment(ctx, appointmentID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("appointment not found")
	}
	var to string
	switch {
	case a.ClientUserID == actorUserID:
		to = domain.StatusCancelledByClient
	case a.MasterUserID == actorUserID:
		to = domain.StatusCancelledByMaster
	default:
		return nil, apperr.Forbidden("access denied")
	}
	return s.changeStatus(ctx, appointmentID, actorUserID, to, reason, func(a *domain.Appointment) error {
		return domain.Transition(a.Status, to)
	})
}

func (s *Service) Start(ctx context.Context, appointmentID, actorUserID uuid.UUID) (*domain.Appointment, error) {
	return s.changeStatus(ctx, appointmentID, actorUserID, domain.StatusInProgress, "", func(a *domain.Appointment) error {
		if a.MasterUserID != actorUserID {
			return apperr.Forbidden("only assigned master can start")
		}
		return domain.Transition(a.Status, domain.StatusInProgress)
	})
}

func (s *Service) Complete(ctx context.Context, appointmentID, actorUserID uuid.UUID) (*domain.Appointment, error) {
	a, err := s.changeStatus(ctx, appointmentID, actorUserID, domain.StatusCompleted, "", func(a *domain.Appointment) error {
		if a.MasterUserID != actorUserID {
			return apperr.Forbidden("only assigned master can complete")
		}
		return domain.Transition(a.Status, domain.StatusCompleted)
	})
	if err != nil {
		return nil, err
	}
	s.notifyVisitCompleted(ctx, a)
	s.createVisitRecord(ctx, a)
	return a, nil
}

func (s *Service) NoShow(ctx context.Context, appointmentID, actorUserID uuid.UUID, reason string) (*domain.Appointment, error) {
	if strings.TrimSpace(reason) == "" {
		reason = "no_show"
	}
	return s.changeStatus(ctx, appointmentID, actorUserID, domain.StatusNoShow, reason, func(a *domain.Appointment) error {
		if a.MasterUserID != actorUserID {
			return apperr.Forbidden("only assigned master can mark no-show")
		}
		return domain.Transition(a.Status, domain.StatusNoShow)
	})
}

func (s *Service) Reschedule(ctx context.Context, appointmentID, actorUserID uuid.UUID, startsAt time.Time) (*domain.Appointment, error) {
	if startsAt.Before(s.now().UTC()) {
		return nil, apperr.Validation("starts_at must be in the future")
	}
	a, err := s.store.GetAppointment(ctx, appointmentID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("appointment not found")
	}
	if a.ClientUserID != actorUserID && a.MasterUserID != actorUserID {
		return nil, apperr.Forbidden("access denied")
	}
	if a.Status != domain.StatusPendingConfirmation && a.Status != domain.StatusConfirmed {
		return nil, apperr.Conflict("cannot reschedule in current status")
	}
	ends := startsAt.UTC().Add(time.Duration(a.DurationMinutes) * time.Minute)
	slots, err := s.FreeSlots(ctx, a.MasterUserID, startsAt, a.DurationMinutes, s.timezoneForBranch(ctx, a.BranchID))
	if err != nil {
		return nil, err
	}
	okSlot := false
	for _, slot := range slots {
		if slot.StartsAt.Equal(startsAt.UTC()) {
			okSlot = true
			break
		}
	}
	if !okSlot {
		return nil, apperr.Conflict("selected time is not available")
	}
	now := s.now().UTC()
	if err := s.store.Reschedule(ctx, a.ID, a.Status, startsAt.UTC(), ends, actorUserID, now); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	a.StartsAt = startsAt.UTC()
	a.EndsAt = ends
	a.UpdatedAt = now
	s.notify(ctx, a.ClientUserID, "appointment.rescheduled", "Запись перенесена", a.ServiceName, a.ID)
	if a.MasterUserID != actorUserID {
		s.notify(ctx, a.MasterUserID, "appointment.rescheduled", "Запись перенесена", a.ServiceName, a.ID)
	}
	return a, nil
}

func (s *Service) History(ctx context.Context, appointmentID, actor uuid.UUID) ([]domain.StatusHistory, error) {
	if _, err := s.Get(ctx, appointmentID, actor); err != nil {
		return nil, err
	}
	items, err := s.store.ListHistory(ctx, appointmentID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.StatusHistory{}
	}
	return items, nil
}

func (s *Service) changeStatus(ctx context.Context, appointmentID, actorUserID uuid.UUID, to, reason string, guard func(*domain.Appointment) error) (*domain.Appointment, error) {
	a, err := s.store.GetAppointment(ctx, appointmentID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("appointment not found")
	}
	if err := guard(a); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	from := a.Status
	if err := s.store.TransitionStatus(ctx, a.ID, from, to, actorUserID, reason, now); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	a.Status = to
	a.CancelReason = reason
	a.UpdatedAt = now
	s.notifyStatus(ctx, a, to)
	return a, nil
}

func (s *Service) notifyStatus(ctx context.Context, a *domain.Appointment, to string) {
	title := "Обновление записи"
	switch to {
	case domain.StatusConfirmed:
		title = "Запись подтверждена"
	case domain.StatusCancelledByClient, domain.StatusCancelledByMaster, domain.StatusCancelledBySalon:
		title = "Запись отменена"
	case domain.StatusInProgress:
		title = "Приём начат"
	case domain.StatusCompleted:
		title = "Визит завершён"
	case domain.StatusNoShow:
		title = "Отмечена неявка"
	}
	s.notify(ctx, a.ClientUserID, "appointment."+to, title, a.ServiceName, a.ID)
	if to != domain.StatusCancelledByMaster {
		s.notify(ctx, a.MasterUserID, "appointment."+to, title, a.ServiceName, a.ID)
	}
}

func (s *Service) notifyVisitCompleted(ctx context.Context, a *domain.Appointment) {
	s.notify(ctx, a.ClientUserID, "review.requested", "Оцените визит", "Вы можете оставить отзыв о записи "+a.ServiceName, a.ID)
}

func (s *Service) notify(ctx context.Context, userID uuid.UUID, typ, title, body string, entityID uuid.UUID) {
	if s.communicationsURL == "" || s.internalToken == "" {
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"user_id": userID.String(), "type": typ, "title": title, "body": body,
		"entity_type": "appointment", "entity_id": entityID.String(),
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

func (s *Service) createVisitRecord(ctx context.Context, a *domain.Appointment) {
	if s.clientsURL == "" || s.internalToken == "" {
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"appointment_id": a.ID.String(), "organization_id": a.OrganizationID.String(),
		"master_user_id": a.MasterUserID.String(), "client_user_id": a.ClientUserID.String(),
		"service_name": a.ServiceName, "price_minor": a.PriceMinor, "currency": a.Currency,
		"started_at": a.StartsAt, "completed_at": a.EndsAt, "display_name": "Клиент",
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.clientsURL+"/v1/internal/visits/from-appointment", strings.NewReader(string(payload)))
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

func (s *Service) Get(ctx context.Context, id, actor uuid.UUID) (*domain.Appointment, error) {
	a, err := s.store.GetAppointment(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("appointment not found")
	}
	if a.ClientUserID != actor && a.MasterUserID != actor {
		return nil, apperr.Forbidden("access denied")
	}
	return a, nil
}

func (s *Service) ListMine(ctx context.Context, userID uuid.UUID, role string) ([]domain.Appointment, error) {
	asMaster := role == "master"
	items, err := s.store.ListForUser(ctx, userID, asMaster)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.Appointment{}
	}
	return items, nil
}

func (s *Service) fetchMaster(ctx context.Context, masterID uuid.UUID) (*masterPayload, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.marketplaceURL+"/v1/masters/"+masterID.String(), nil)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusNotFound {
		return nil, apperr.NotFound("master not found")
	}
	if resp.StatusCode >= 300 {
		return nil, apperr.Internal(fmt.Errorf("marketplace status %d", resp.StatusCode))
	}
	var payload masterPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, apperr.Internal(err)
	}
	return &payload, nil
}
