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
	store            *store.Store
	marketplaceURL   string
	httpClient       *http.Client
	now              func() time.Time
}

func New(st *store.Store, marketplaceURL string) *Service {
	return &Service{
		store:          st,
		marketplaceURL: strings.TrimRight(marketplaceURL, "/"),
		httpClient:     &http.Client{Timeout: 5 * time.Second},
		now:            time.Now,
	}
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

func (s *Service) FreeSlots(ctx context.Context, masterUserID uuid.UUID, day time.Time, durationMinutes int) ([]Slot, error) {
	if durationMinutes <= 0 {
		return nil, apperr.Validation("duration_minutes must be positive")
	}
	day = time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC)
	weekday := int(day.Weekday())
	hours, err := s.store.ListWorkingHours(ctx, masterUserID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	existing, err := s.store.ListAppointmentsInRange(ctx, masterUserID, day, day.Add(24*time.Hour))
	if err != nil {
		return nil, apperr.Internal(err)
	}
	var slots []Slot
	step := 30
	for _, h := range hours {
		if h.Weekday != weekday {
			continue
		}
		for start := h.StartMinute; start+durationMinutes <= h.EndMinute; start += step {
			st := day.Add(time.Duration(start) * time.Minute)
			en := st.Add(time.Duration(durationMinutes) * time.Minute)
			if st.Before(s.now().UTC()) {
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
	slots, err := s.FreeSlots(ctx, masterUserID, in.StartsAt.UTC(), duration)
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
	return &a, nil
}

func (s *Service) Confirm(ctx context.Context, appointmentID, actorUserID uuid.UUID) (*domain.Appointment, error) {
	a, err := s.store.GetAppointment(ctx, appointmentID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("appointment not found")
	}
	if a.MasterUserID != actorUserID {
		return nil, apperr.Forbidden("only assigned master can confirm")
	}
	if err := domain.Transition(a.Status, domain.StatusConfirmed); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	if err := s.store.UpdateStatus(ctx, a.ID, domain.StatusConfirmed, now); err != nil {
		return nil, apperr.Internal(err)
	}
	a.Status = domain.StatusConfirmed
	a.UpdatedAt = now
	return a, nil
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
