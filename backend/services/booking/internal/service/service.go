package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type Service struct {
	store             *store.Store
	marketplaceURL    string
	organizationsURL  string
	clientsURL        string
	communicationsURL string
	commerceURL       string
	identityURL       string
	internalToken     string
	httpClient        *http.Client
	now               func() time.Time
}

func New(st *store.Store, marketplaceURL string) *Service {
	return &Service{
		store:          st,
		marketplaceURL: strings.TrimRight(marketplaceURL, "/"),
		httpClient:     &http.Client{Timeout: 5 * time.Second},
		now:            time.Now,
	}
}

func (s *Service) WithCommerce(commerceURL string) *Service {
	s.commerceURL = strings.TrimRight(commerceURL, "/")
	return s
}

func (s *Service) WithIntegrations(organizationsURL, clientsURL, communicationsURL, internalToken string) *Service {
	s.organizationsURL = strings.TrimRight(organizationsURL, "/")
	s.clientsURL = strings.TrimRight(clientsURL, "/")
	s.communicationsURL = strings.TrimRight(communicationsURL, "/")
	s.internalToken = internalToken
	return s
}

func (s *Service) FreeSlots(ctx context.Context, masterUserID uuid.UUID, day time.Time, durationMinutes int, timezone string, excludeAppointmentID uuid.UUID) ([]Slot, error) {
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

	// Date column is calendar-day; query with UTC midnight of that Y-M-D to avoid TZ shifts.
	dayKey := time.Date(localDay.Year(), localDay.Month(), localDay.Day(), 0, 0, 0, 0, time.UTC)
	exception, err := s.store.GetScheduleException(ctx, masterUserID, dayKey)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if exception != nil && exception.IsDayOff {
		return []Slot{}, nil
	}

	type interval struct{ start, end int }
	var windows []interval
	if exception != nil && !exception.IsDayOff && exception.StartMinute != nil && exception.EndMinute != nil {
		windows = append(windows, interval{*exception.StartMinute, *exception.EndMinute})
	} else {
		hours, err := s.store.ListWorkingHours(ctx, masterUserID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		for _, h := range hours {
			if h.Weekday == weekday {
				windows = append(windows, interval{h.StartMinute, h.EndMinute})
			}
		}
	}

	existing, err := s.store.ListAppointmentsInRange(ctx, masterUserID, fromUTC, toUTC)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	blocks, err := s.store.ListPlannerBlocks(ctx, masterUserID, fromUTC, toUTC)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	var slots []Slot
	step := 30
	now := s.now().UTC()
	for _, w := range windows {
		for start := w.start; start+durationMinutes <= w.end; start += step {
			st := localDay.Add(time.Duration(start) * time.Minute).UTC()
			en := st.Add(time.Duration(durationMinutes) * time.Minute)
			if !st.After(now) {
				continue
			}
			if appointmentBlocksSlot(existing, excludeAppointmentID, st, en) {
				continue
			}
			if plannerBlocksSlot(blocks, uuid.Nil, st, en) {
				continue
			}
			mode, ok, err := s.workModeForSlot(ctx, masterUserID, st, en, loc)
			if err != nil {
				return nil, apperr.Internal(err)
			}
			if !ok {
				continue
			}
			slots = append(slots, Slot{StartsAt: st, EndsAt: en, WorkMode: mode})
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
			if loc := s.fetchBranchLocation(ctx, branchID); loc != nil && loc.Timezone != "" {
				return loc.Timezone, nil
			}
		}
	}
	return defaultTimezone, nil
}

func (s *Service) timezoneForBranch(ctx context.Context, branchID uuid.UUID) string {
	if loc := s.fetchBranchLocation(ctx, branchID); loc != nil && loc.Timezone != "" {
		return loc.Timezone
	}
	return defaultTimezone
}

type branchLocation struct {
	Name     string
	City     string
	Address  string
	Timezone string
}

func (s *Service) fetchMasterBranchID(ctx context.Context, masterUserID uuid.UUID) (uuid.UUID, bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.marketplaceURL+"/v1/masters/"+masterUserID.String(), nil)
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
	var payload struct {
		Master struct {
			BranchID *string `json:"branch_id"`
		} `json:"master"`
		BranchID *string `json:"branch_id"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return uuid.Nil, false
	}
	raw := payload.Master.BranchID
	if raw == nil {
		raw = payload.BranchID
	}
	if raw == nil {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(*raw)
	if err != nil {
		return uuid.Nil, false
	}
	return id, true
}

func (s *Service) fetchBranchLocation(ctx context.Context, branchID uuid.UUID) *branchLocation {
	if s.organizationsURL == "" || branchID == uuid.Nil {
		return nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.organizationsURL+"/v1/branches/"+branchID.String(), nil)
	if err != nil {
		return nil
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var payload struct {
		Name        string `json:"name"`
		City        string `json:"city"`
		AddressLine string `json:"address_line"`
		Timezone    string `json:"timezone"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil
	}
	tz := payload.Timezone
	if tz == "" {
		tz = defaultTimezone
	} else if _, err := time.LoadLocation(tz); err != nil {
		tz = defaultTimezone
	}
	return &branchLocation{
		Name: payload.Name, City: payload.City, Address: payload.AddressLine, Timezone: tz,
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
	if err := s.rejectHoursIfAppointmentsOutside(ctx, masterUserID, inputs); err != nil {
		return nil, err
	}
	if err := s.store.ReplaceWorkingHours(ctx, masterUserID, hours); err != nil {
		return nil, apperr.Internal(err)
	}
	return hours, nil
}

func (s *Service) SetStaffWorkingHours(ctx context.Context, actor, orgID, masterUserID uuid.UUID, inputs []HoursInput) ([]domain.WorkingHours, error) {
	if masterUserID == uuid.Nil {
		return nil, apperr.Validation("master_user_id is required")
	}
	if actor != masterUserID {
		if err := s.requireMembership(ctx, orgID, actor, "owner", "admin"); err != nil {
			return nil, err
		}
		if err := s.requireMembership(ctx, orgID, masterUserID, "owner", "admin", "master"); err != nil {
			return nil, err
		}
	}
	return s.SetWorkingHours(ctx, masterUserID, inputs)
}

func (s *Service) rejectHoursIfAppointmentsOutside(ctx context.Context, masterUserID uuid.UUID, inputs []HoursInput) error {
	from := s.now().UTC()
	to := from.AddDate(0, 0, 60)
	items, err := s.store.ListAppointmentsInRange(ctx, masterUserID, from, to)
	if err != nil {
		return apperr.Internal(err)
	}
	byWeekday := map[int]HoursInput{}
	for _, in := range inputs {
		byWeekday[in.Weekday] = in
	}
	for _, a := range items {
		tz := a.LocationTimezone
		if tz == "" {
			tz = "Europe/Moscow"
		}
		loc, err := time.LoadLocation(tz)
		if err != nil {
			loc = time.UTC
		}
		local := a.StartsAt.In(loc)
		wd := int(local.Weekday())
		startMin := local.Hour()*60 + local.Minute()
		endLocal := a.EndsAt.In(loc)
		endMin := endLocal.Hour()*60 + endLocal.Minute()
		if endLocal.Day() != local.Day() || endMin <= startMin {
			endMin = 24 * 60
		}
		hours, ok := byWeekday[wd]
		if !ok || startMin < hours.StartMinute || endMin > hours.EndMinute {
			return apperr.Conflict("existing appointments would fall outside the new schedule")
		}
	}
	return nil
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

func (s *Service) CalendarWorkingHours(ctx context.Context, actor, orgID, masterUserID uuid.UUID) ([]domain.WorkingHours, error) {
	if masterUserID == uuid.Nil {
		masterUserID = actor
	}
	if masterUserID != actor {
		if err := s.requireMembership(ctx, orgID, actor, "owner", "admin"); err != nil {
			return nil, err
		}
	}
	return s.GetWorkingHours(ctx, masterUserID)
}

func (s *Service) CalendarScheduleExceptions(ctx context.Context, actor, orgID, masterUserID uuid.UUID, from, to time.Time) ([]domain.ScheduleException, error) {
	if masterUserID == uuid.Nil {
		masterUserID = actor
	}
	if masterUserID != actor {
		if err := s.requireMembership(ctx, orgID, actor, "owner", "admin"); err != nil {
			return nil, err
		}
	}
	return s.ListScheduleExceptions(ctx, masterUserID, from, to)
}

type ScheduleExceptionInput struct {
	Day         string `json:"day"` // YYYY-MM-DD
	IsDayOff    bool   `json:"is_day_off"`
	StartMinute *int   `json:"start_minute"`
	EndMinute   *int   `json:"end_minute"`
	Note        string `json:"note"`
}

func (s *Service) ListScheduleExceptions(ctx context.Context, masterUserID uuid.UUID, from, to time.Time) ([]domain.ScheduleException, error) {
	if to.Before(from) {
		return nil, apperr.Validation("to must be on or after from")
	}
	items, err := s.store.ListScheduleExceptions(ctx, masterUserID, from, to)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.ScheduleException{}
	}
	return items, nil
}

func (s *Service) UpsertStaffScheduleExceptions(ctx context.Context, actor, orgID, masterUserID uuid.UUID, inputs []ScheduleExceptionInput) ([]domain.ScheduleException, error) {
	if actor != masterUserID {
		if err := s.requireMembership(ctx, orgID, actor, "owner", "admin"); err != nil {
			return nil, err
		}
		if err := s.requireMembership(ctx, orgID, masterUserID, "owner", "admin", "master"); err != nil {
			return nil, err
		}
	}
	return s.UpsertScheduleExceptions(ctx, masterUserID, inputs)
}

func (s *Service) UpsertScheduleExceptions(ctx context.Context, masterUserID uuid.UUID, inputs []ScheduleExceptionInput) ([]domain.ScheduleException, error) {
	if len(inputs) == 0 {
		return nil, apperr.Validation("at least one exception is required")
	}
	now := s.now().UTC()
	out := make([]domain.ScheduleException, 0, len(inputs))
	for _, in := range inputs {
		day, err := time.Parse("2006-01-02", strings.TrimSpace(in.Day))
		if err != nil {
			return nil, apperr.Validation("day must be YYYY-MM-DD")
		}
		e := domain.ScheduleException{
			ID: ids.New(), MasterUserID: masterUserID, Day: day, IsDayOff: in.IsDayOff,
			Note: strings.TrimSpace(in.Note), CreatedAt: now,
		}
		if in.IsDayOff {
			e.StartMinute = nil
			e.EndMinute = nil
		} else {
			if in.StartMinute == nil || in.EndMinute == nil {
				return nil, apperr.Validation("start_minute and end_minute are required when is_day_off is false")
			}
			if *in.StartMinute < 0 || *in.EndMinute > 1440 || *in.EndMinute <= *in.StartMinute {
				return nil, apperr.Validation("invalid custom hours interval")
			}
			e.StartMinute = in.StartMinute
			e.EndMinute = in.EndMinute
		}
		saved, err := s.store.UpsertScheduleException(ctx, e)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		out = append(out, *saved)
	}
	return out, nil
}

func (s *Service) DeleteScheduleException(ctx context.Context, masterUserID uuid.UUID, day time.Time) error {
	if err := s.store.DeleteScheduleException(ctx, masterUserID, day); err != nil {
		if ae, ok := apperr.As(err); ok {
			return ae
		}
		return apperr.Internal(err)
	}
	return nil
}

type Slot struct {
	StartsAt time.Time `json:"starts_at"`
	EndsAt   time.Time `json:"ends_at"`
	WorkMode string    `json:"work_mode,omitempty"`
}

type CreateInput struct {
	ClientUserID   uuid.UUID
	ActorUserID    uuid.UUID
	MasterID       uuid.UUID
	ServiceID      uuid.UUID
	StartsAt       time.Time
	OccurrenceID   *uuid.UUID
	IdempotencyKey string
	DistrictID     *uuid.UUID
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

type occurrencePayload struct {
	ID              string     `json:"id"`
	ServiceID       string     `json:"service_id"`
	MasterUserID    string     `json:"master_user_id"`
	BranchID        *string    `json:"branch_id"`
	StartsAt        time.Time  `json:"starts_at"`
	EndsAt          time.Time  `json:"ends_at"`
	Timezone        string     `json:"timezone"`
	Capacity        int        `json:"capacity"`
	BookedCount     int        `json:"booked_count"`
	Status          string     `json:"status"`
	BookingCutoffAt *time.Time `json:"booking_cutoff_at"`
	Title           string     `json:"title"`
}

const createAppointmentOp = "create_appointment"

func (s *Service) Create(ctx context.Context, in CreateInput) (*domain.Appointment, error) {
	idemKey := strings.TrimSpace(in.IdempotencyKey)
	if idemKey != "" {
		rec, err := s.store.GetIdempotency(ctx, idemKey, in.ClientUserID, createAppointmentOp)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if rec != nil && rec.EntityID != nil {
			existing, err := s.store.GetAppointment(ctx, *rec.EntityID)
			if err != nil {
				return nil, apperr.Internal(err)
			}
			if existing != nil {
				return existing, nil
			}
		}
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
	if in.ActorUserID == uuid.Nil {
		in.ActorUserID = in.ClientUserID
	}
	if in.ClientUserID != in.ActorUserID && in.ActorUserID != masterUserID {
		return nil, apperr.Forbidden("only the assigned master can book for a client")
	}
	blocked, err := s.store.IsBlacklisted(ctx, masterUserID, in.ClientUserID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if blocked {
		return nil, apperr.ForbiddenCode(apperr.CodeClientBlacklisted, "client is blacklisted for this master")
	}
	orgID, err := uuid.Parse(payload.Master.OrganizationID)
	if err != nil {
		return nil, apperr.Internal(fmt.Errorf("bad org id"))
	}
	if payload.Master.BranchID == nil {
		return nil, apperr.Validation("master has no branch")
	}
	masterBranchID, err := uuid.Parse(*payload.Master.BranchID)
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

	branchID := masterBranchID
	bookingMode := domain.BookingModeFlexible
	startsAt := in.StartsAt.UTC()
	endsAt := startsAt.Add(time.Duration(duration) * time.Minute)
	var occurrenceID *uuid.UUID
	bookedOccurrence := false

	if in.OccurrenceID != nil && *in.OccurrenceID != uuid.Nil {
		occ, err := s.fetchOccurrence(ctx, *in.OccurrenceID)
		if err != nil {
			return nil, err
		}
		if occ.ServiceID != in.ServiceID.String() {
			return nil, apperr.Validation("occurrence does not match service")
		}
		if occ.MasterUserID != masterUserID.String() {
			return nil, apperr.Validation("occurrence does not match master")
		}
		if occ.Status != "scheduled" {
			return nil, apperr.ConflictCode(apperr.CodeOccurrenceUnavailable, "occurrence is not available")
		}
		now := s.now().UTC()
		if occ.BookingCutoffAt != nil && !now.Before(occ.BookingCutoffAt.UTC()) {
			return nil, apperr.ConflictCode(apperr.CodeBookingCutoff, "booking cutoff has passed")
		}
		if !occ.StartsAt.After(now) {
			return nil, apperr.Validation("occurrence has already started")
		}
		startsAt = occ.StartsAt.UTC()
		endsAt = occ.EndsAt.UTC()
		durMin := int(endsAt.Sub(startsAt).Minutes())
		if durMin <= 0 {
			return nil, apperr.Validation("invalid occurrence duration")
		}
		duration = durMin
		bookingMode = domain.BookingModeFixedWindow
		id := *in.OccurrenceID
		occurrenceID = &id
		if occ.BranchID != nil && *occ.BranchID != "" {
			bid, err := uuid.Parse(*occ.BranchID)
			if err != nil {
				return nil, apperr.Validation("invalid occurrence branch")
			}
			branchID = bid
		}
		if err := s.bookOccurrence(ctx, id); err != nil {
			return nil, err
		}
		bookedOccurrence = true
	} else {
		if in.StartsAt.Before(s.now().UTC()) {
			return nil, apperr.Validation("starts_at must be in the future")
		}
		slots, err := s.FreeSlots(ctx, masterUserID, in.StartsAt, duration, s.timezoneForBranch(ctx, branchID), uuid.Nil)
		if err != nil {
			return nil, err
		}
		okSlot := false
		for _, slot := range slots {
			if slot.StartsAt.Equal(startsAt) {
				okSlot = true
				break
			}
		}
		if !okSlot {
			return nil, apperr.ConflictCode(apperr.CodeAppointmentTimeConflict, "selected time is not available")
		}
	}

	loc := s.fetchBranchLocation(ctx, branchID)
	locName, locCity, locAddr, locTZ := "", "", "", defaultTimezone
	if loc != nil {
		locName, locCity, locAddr, locTZ = loc.Name, loc.City, loc.Address, loc.Timezone
	}

	now := s.now().UTC()
	status := domain.StatusPendingConfirmation
	auto, err := s.store.GetClientAutoConfirm(ctx, masterUserID, in.ClientUserID)
	if err != nil {
		if bookedOccurrence {
			_ = s.releaseOccurrence(ctx, *occurrenceID)
		}
		return nil, apperr.Internal(err)
	}
	if auto {
		status = domain.StatusConfirmed
	}
	a := domain.Appointment{
		ID: ids.New(), OrganizationID: orgID, BranchID: branchID, MasterUserID: masterUserID,
		ClientUserID: in.ClientUserID, ServiceID: in.ServiceID, ServiceName: svcName,
		DurationMinutes: duration, PriceMinor: price, Currency: currency,
		Status: status, StartsAt: startsAt, EndsAt: endsAt,
		OccurrenceID: occurrenceID, BookingMode: bookingMode,
		LocationName: locName, LocationCity: locCity, LocationAddress: locAddr, LocationTimezone: locTZ,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := s.attachWorkModeSnapshot(ctx, &a, in.DistrictID); err != nil {
		if bookedOccurrence {
			_ = s.releaseOccurrence(ctx, *occurrenceID)
		}
		return nil, err
	}
	if err := s.store.CreateAppointment(ctx, a); err != nil {
		if bookedOccurrence {
			_ = s.releaseOccurrence(ctx, *occurrenceID)
		}
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	if idemKey != "" {
		_ = s.store.PutIdempotency(ctx, idemKey, in.ClientUserID, createAppointmentOp, a.ID, http.StatusCreated)
	}
	if status == domain.StatusConfirmed {
		s.notify(ctx, a.MasterUserID, "appointment.created", "Новая запись", a.ServiceName+" (автоподтверждение)", a.ID)
		s.notify(ctx, a.ClientUserID, "appointment.created", "Запись подтверждена", "Мастер разрешил автоподтверждение", a.ID)
	} else {
		s.notify(ctx, a.MasterUserID, "appointment.created", "Новая запись", a.ServiceName, a.ID)
		s.notify(ctx, a.ClientUserID, "appointment.created", "Запись создана", "Ожидает подтверждения мастера", a.ID)
	}
	return &a, nil
}

func (s *Service) fetchOccurrence(ctx context.Context, id uuid.UUID) (*occurrencePayload, error) {
	if s.marketplaceURL == "" {
		return nil, apperr.Internal(fmt.Errorf("marketplace url not configured"))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.marketplaceURL+"/v1/occurrences/"+id.String(), nil)
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
		return nil, apperr.NotFound("occurrence not found")
	}
	if resp.StatusCode >= 300 {
		return nil, apperr.Internal(fmt.Errorf("marketplace occurrence status %d", resp.StatusCode))
	}
	var payload struct {
		Occurrence occurrencePayload `json:"occurrence"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		// Also accept bare object.
		if err2 := json.Unmarshal(body, &payload.Occurrence); err2 != nil {
			return nil, apperr.Internal(err)
		}
	}
	if payload.Occurrence.ID == "" {
		return nil, apperr.NotFound("occurrence not found")
	}
	return &payload.Occurrence, nil
}

func (s *Service) bookOccurrence(ctx context.Context, id uuid.UUID) error {
	return s.occurrenceCapacityCall(ctx, id, "book")
}

func (s *Service) releaseOccurrence(ctx context.Context, id uuid.UUID) error {
	return s.occurrenceCapacityCall(ctx, id, "release")
}

func (s *Service) occurrenceCapacityCall(ctx context.Context, id uuid.UUID, action string) error {
	if s.marketplaceURL == "" || s.internalToken == "" {
		return apperr.Internal(fmt.Errorf("marketplace internal call not configured"))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		s.marketplaceURL+"/v1/internal/occurrences/"+id.String()+"/"+action, nil)
	if err != nil {
		return apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return apperr.Internal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<10))
	if resp.StatusCode == http.StatusConflict {
		return apperr.ConflictCode(apperr.CodeOccurrenceUnavailable, "occurrence is not available")
	}
	if resp.StatusCode == http.StatusNotFound {
		return apperr.NotFound("occurrence not found")
	}
	if resp.StatusCode >= 300 {
		return apperr.Internal(fmt.Errorf("marketplace %s status %d: %s", action, resp.StatusCode, string(body)))
	}
	return nil
}

func (s *Service) GetClientAutoConfirm(ctx context.Context, masterUserID, clientUserID uuid.UUID) (bool, error) {
	auto, err := s.store.GetClientAutoConfirm(ctx, masterUserID, clientUserID)
	if err != nil {
		return false, apperr.Internal(err)
	}
	return auto, nil
}

func (s *Service) SetClientAutoConfirm(ctx context.Context, masterUserID, clientUserID uuid.UUID, autoConfirm bool) error {
	if masterUserID == clientUserID {
		return apperr.Validation("cannot set auto-confirm for yourself")
	}
	if err := s.store.SetClientAutoConfirm(ctx, masterUserID, clientUserID, autoConfirm, s.now().UTC()); err != nil {
		return apperr.Internal(err)
	}
	return nil
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
	case s.isOrgOwnerOrAdmin(ctx, a.OrganizationID, actorUserID):
		to = domain.StatusCancelledBySalon
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
	return s.CompleteVisit(ctx, appointmentID, actorUserID, &VisitSchemeInput{})
}

func (s *Service) NoShow(ctx context.Context, appointmentID, actorUserID uuid.UUID, reason string) (*domain.Appointment, error) {
	if strings.TrimSpace(reason) == "" {
		reason = "no_show"
	}
	a, err := s.changeStatus(ctx, appointmentID, actorUserID, domain.StatusNoShow, reason, func(a *domain.Appointment) error {
		if a.MasterUserID != actorUserID {
			return apperr.Forbidden("only assigned master can mark no-show")
		}
		return domain.Transition(a.Status, domain.StatusNoShow)
	})
	if err != nil {
		return nil, err
	}
	s.afterNoShow(ctx, a, actorUserID)
	s.createVisitRecord(ctx, a)
	return a, nil
}

func (s *Service) afterNoShow(ctx context.Context, a *domain.Appointment, actor uuid.UUID) {
	n, err := s.store.CountNoShows(ctx, a.MasterUserID, a.ClientUserID)
	if err != nil || n < 2 {
		return
	}
	now := s.now().UTC()
	_ = s.store.UpsertBlacklist(ctx, a.MasterUserID, a.ClientUserID, actor, "no_show_threshold", now)
	_ = s.store.AddBookingAudit(ctx, actor, "blacklist.auto", "client", a.ClientUserID, `{"reason":"no_show_threshold"}`, now)
}

func (s *Service) UnblockClient(ctx context.Context, masterID, clientID uuid.UUID) error {
	now := s.now().UTC()
	if err := s.store.UnblockClient(ctx, masterID, clientID, masterID, now); err != nil {
		return apperr.Internal(err)
	}
	_ = s.store.AddBookingAudit(ctx, masterID, "blacklist.unblocked", "client", clientID, `{}`, now)
	return nil
}

func (s *Service) ClientBlacklistStatus(ctx context.Context, masterID, clientID uuid.UUID) (bool, int, error) {
	blocked, err := s.store.IsBlacklisted(ctx, masterID, clientID)
	if err != nil {
		return false, 0, apperr.Internal(err)
	}
	noShows, err := s.store.CountNoShows(ctx, masterID, clientID)
	if err != nil {
		return false, 0, apperr.Internal(err)
	}
	return blocked, noShows, nil
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
	if a.ClientUserID != actorUserID && a.MasterUserID != actorUserID && !s.isOrgOwnerOrAdmin(ctx, a.OrganizationID, actorUserID) {
		return nil, apperr.Forbidden("access denied")
	}
	if err := rescheduleEligibility(a); err != nil {
		return nil, err
	}
	ends := startsAt.UTC().Add(time.Duration(a.DurationMinutes) * time.Minute)
	tz := a.LocationTimezone
	if tz == "" {
		tz = s.timezoneForBranch(ctx, a.BranchID)
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return nil, apperr.Validation("invalid timezone")
	}
	// FreeSlots treats Year/Month/Day of `day` as the salon calendar date in `tz`.
	localStart := startsAt.In(loc)
	slots, err := s.FreeSlots(ctx, a.MasterUserID, localStart, a.DurationMinutes, tz, a.ID)
	if err != nil {
		return nil, err
	}
	if !ContainsSlotStart(slots, startsAt) {
		return nil, apperr.ConflictCode(apperr.CodeAppointmentTimeConflict, "selected time is not available")
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
	display := "Клиент"
	payload := map[string]any{
		"appointment_id": a.ID.String(), "organization_id": a.OrganizationID.String(),
		"master_user_id": a.MasterUserID.String(), "client_user_id": a.ClientUserID.String(),
		"service_name": a.ServiceName, "price_minor": a.PriceMinor, "currency": a.Currency,
		"started_at": a.StartsAt, "completed_at": a.EndsAt, "display_name": display,
	}
	if s.identityURL != "" {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.identityURL+"/v1/internal/users/"+a.ClientUserID.String(), nil)
		if err == nil {
			req.Header.Set("X-Internal-Token", s.internalToken)
			if resp, err := s.httpClient.Do(req); err == nil {
				body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
				_ = resp.Body.Close()
				if resp.StatusCode < 300 {
					var u struct {
						DisplayName string  `json:"display_name"`
						Phone       *string `json:"phone"`
						Email       *string `json:"email"`
					}
					if json.Unmarshal(body, &u) == nil {
						if strings.TrimSpace(u.DisplayName) != "" {
							payload["display_name"] = u.DisplayName
						}
						if u.Phone != nil && strings.TrimSpace(*u.Phone) != "" {
							payload["phone"] = *u.Phone
						}
						if u.Email != nil && strings.TrimSpace(*u.Email) != "" {
							payload["email"] = *u.Email
						}
					}
				}
			}
		}
	}
	raw, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.clientsURL+"/v1/internal/visits/from-appointment", strings.NewReader(string(raw)))
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

func (s *Service) consumeStockForAppointment(ctx context.Context, a *domain.Appointment, actorUserID uuid.UUID) {
	if s.commerceURL == "" || s.internalToken == "" {
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"organization_id": a.OrganizationID.String(),
		"service_id":      a.ServiceID.String(),
		"appointment_id":  a.ID.String(),
		"actor_user_id":   actorUserID.String(),
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.commerceURL+"/v1/internal/stock/consume-appointment", strings.NewReader(string(payload)))
	if err != nil {
		slog.Warn("commerce consume-appointment request failed", "appointment_id", a.ID, "error", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		slog.Warn("commerce consume-appointment call failed", "appointment_id", a.ID, "error", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<10))
		slog.Warn("commerce consume-appointment rejected", "appointment_id", a.ID, "status", resp.StatusCode, "body", string(body))
	}
}

func (s *Service) Get(ctx context.Context, id, actor uuid.UUID) (*domain.Appointment, error) {
	a, err := s.store.GetAppointment(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("appointment not found")
	}
	if a.ClientUserID != actor && a.MasterUserID != actor && !s.isOrgOwnerOrAdmin(ctx, a.OrganizationID, actor) {
		return nil, apperr.Forbidden("access denied")
	}
	return a, nil
}

func (s *Service) ListMine(ctx context.Context, userID uuid.UUID, role string, from, to *time.Time) ([]domain.Appointment, error) {
	asMaster := role == "master"
	var items []domain.Appointment
	var err error
	if from != nil && to != nil {
		items, err = s.store.ListForUserInRange(ctx, userID, asMaster, from.UTC(), to.UTC())
	} else {
		items, err = s.store.ListForUser(ctx, userID, asMaster)
	}
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.Appointment{}
	}
	return items, nil
}

func (s *Service) isOrgOwnerOrAdmin(ctx context.Context, orgID, actor uuid.UUID) bool {
	if orgID == uuid.Nil || actor == uuid.Nil {
		return false
	}
	return s.requireMembership(ctx, orgID, actor, "owner", "admin") == nil
}

func (s *Service) ListOrgCalendar(ctx context.Context, actor, orgID uuid.UUID, from, to time.Time) ([]domain.Appointment, error) {
	if err := s.requireMembership(ctx, orgID, actor, "owner", "admin"); err != nil {
		return nil, err
	}
	statuses := []string{
		domain.StatusPendingConfirmation,
		domain.StatusConfirmed,
		domain.StatusInProgress,
		domain.StatusCompleted,
		domain.StatusCancelledByClient,
		domain.StatusCancelledByMaster,
		domain.StatusCancelledBySalon,
		domain.StatusNoShow,
	}
	items, err := s.store.ListByOrgInRange(ctx, orgID, from.UTC(), to.UTC(), statuses)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.Appointment{}
	}
	return items, nil
}

func (s *Service) ListOrgAppointmentsInRange(ctx context.Context, orgID uuid.UUID, from, to time.Time, statuses []string) ([]domain.Appointment, error) {
	if orgID == uuid.Nil {
		return nil, apperr.Validation("organization_id is required")
	}
	if !to.After(from) {
		return nil, apperr.Validation("to must be after from")
	}
	items, err := s.store.ListByOrgInRange(ctx, orgID, from.UTC(), to.UTC(), statuses)
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

func (s *Service) ListAppointmentPhotos(ctx context.Context, appointmentID, actor uuid.UUID) ([]domain.AppointmentPhoto, error) {
	if _, err := s.Get(ctx, appointmentID, actor); err != nil {
		return nil, err
	}
	items, err := s.store.ListAppointmentPhotos(ctx, appointmentID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.AppointmentPhoto{}
	}
	return items, nil
}

func (s *Service) AddAppointmentPhoto(ctx context.Context, appointmentID, actor, mediaID uuid.UUID, kind string) (*domain.AppointmentPhoto, error) {
	a, err := s.Get(ctx, appointmentID, actor)
	if err != nil {
		return nil, err
	}
	if a.MasterUserID != actor {
		return nil, apperr.Forbidden("only the master can upload visit photos")
	}
	kind = strings.TrimSpace(kind)
	if kind != "before" && kind != "after" {
		return nil, apperr.Validation("kind must be before or after")
	}
	if mediaID == uuid.Nil {
		return nil, apperr.Validation("media_id is required")
	}
	now := s.now().UTC()
	p := domain.AppointmentPhoto{
		ID: ids.New(), AppointmentID: appointmentID, MediaID: mediaID, Kind: kind, CreatedBy: actor, CreatedAt: now,
	}
	if err := s.store.CreateAppointmentPhoto(ctx, p); err != nil {
		return nil, apperr.Internal(err)
	}
	return &p, nil
}

func (s *Service) DeleteAppointmentPhoto(ctx context.Context, photoID, actor uuid.UUID) error {
	p, err := s.store.GetAppointmentPhoto(ctx, photoID)
	if err != nil {
		return apperr.Internal(err)
	}
	if p == nil {
		return apperr.NotFound("photo not found")
	}
	a, err := s.Get(ctx, p.AppointmentID, actor)
	if err != nil {
		return err
	}
	if a.MasterUserID != actor {
		return apperr.Forbidden("only the master can delete visit photos")
	}
	if err := s.store.DeleteAppointmentPhoto(ctx, photoID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.NotFound("photo not found")
		}
		return apperr.Internal(err)
	}
	return nil
}
