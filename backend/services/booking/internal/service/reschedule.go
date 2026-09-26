package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

const (
	DefaultRescheduleLimit = 6
	MaxRescheduleLimit     = 24
	RescheduleHorizonDays  = 14
)

type RescheduleOptions struct {
	Appointment       *domain.Appointment
	Timezone          string
	MasterDisplayName string
	Items             []Slot
	HasMore           bool
	HorizonDays       int
}

func rescheduleEligibility(a *domain.Appointment) error {
	if a == nil {
		return apperr.NotFound("appointment not found")
	}
	if a.BookingMode == domain.BookingModeFixedWindow {
		return apperr.ConflictCode(apperr.CodeAppointmentNotReschedulable, "fixed_window appointments cannot be rescheduled")
	}
	if !domain.CanReschedule(a.Status, a.BookingMode) {
		return apperr.ConflictCode(apperr.CodeAppointmentStatusInvalid, "cannot reschedule in current status")
	}
	return nil
}

// CollectRescheduleSlots walks chronological per-day FreeSlots results and keeps
// the first `limit` unique future starts, skipping the appointment's current start.
func CollectRescheduleSlots(currentStartsAt time.Time, perDay [][]Slot, limit int) []Slot {
	if limit <= 0 {
		return []Slot{}
	}
	current := currentStartsAt.UTC()
	seen := map[int64]struct{}{}
	out := make([]Slot, 0, limit)
	for _, day := range perDay {
		for _, slot := range day {
			st := slot.StartsAt.UTC()
			if st.Equal(current) {
				continue
			}
			key := st.UnixNano()
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			out = append(out, Slot{StartsAt: st, EndsAt: slot.EndsAt.UTC(), WorkMode: slot.WorkMode})
			if len(out) >= limit {
				return out
			}
		}
	}
	return out
}

// ContainsSlotStart reports whether FreeSlots already emitted this start instant.
func ContainsSlotStart(slots []Slot, startsAt time.Time) bool {
	want := startsAt.UTC()
	for _, slot := range slots {
		if slot.StartsAt.UTC().Equal(want) {
			return true
		}
	}
	return false
}

func (s *Service) RescheduleOptions(ctx context.Context, appointmentID, actor uuid.UUID, limit int) (*RescheduleOptions, error) {
	if limit <= 0 {
		limit = DefaultRescheduleLimit
	}
	if limit > MaxRescheduleLimit {
		limit = MaxRescheduleLimit
	}
	a, err := s.Get(ctx, appointmentID, actor)
	if err != nil {
		return nil, err
	}
	if err := rescheduleEligibility(a); err != nil {
		return nil, err
	}
	tz := a.LocationTimezone
	if tz == "" {
		tz = s.timezoneForBranch(ctx, a.BranchID)
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return nil, apperr.Validation("invalid timezone")
	}

	nowLocal := s.now().In(loc)
	origin := time.Date(nowLocal.Year(), nowLocal.Month(), nowLocal.Day(), 0, 0, 0, 0, loc)
	perDay := make([][]Slot, 0, RescheduleHorizonDays)
	for i := 0; i < RescheduleHorizonDays; i++ {
		day := origin.AddDate(0, 0, i)
		slots, err := s.FreeSlots(ctx, a.MasterUserID, day, a.DurationMinutes, tz, a.ID)
		if err != nil {
			return nil, err
		}
		perDay = append(perDay, slots)
	}
	probe := CollectRescheduleSlots(a.StartsAt, perDay, limit+1)
	hasMore := len(probe) > limit
	items := probe
	if hasMore {
		items = probe[:limit]
	}
	if items == nil {
		items = []Slot{}
	}
	return &RescheduleOptions{
		Appointment:       a,
		Timezone:          tz,
		MasterDisplayName: s.fetchMasterDisplayName(ctx, a.MasterUserID),
		Items:             items,
		HasMore:           hasMore,
		HorizonDays:       RescheduleHorizonDays,
	}, nil
}

func (s *Service) fetchMasterDisplayName(ctx context.Context, masterUserID uuid.UUID) string {
	if s.marketplaceURL == "" || masterUserID == uuid.Nil {
		return ""
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.marketplaceURL+"/v1/masters/"+masterUserID.String(), nil)
	if err != nil {
		return ""
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var payload struct {
		Master struct {
			DisplayName string `json:"display_name"`
		} `json:"master"`
		DisplayName string `json:"display_name"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return ""
	}
	if payload.Master.DisplayName != "" {
		return payload.Master.DisplayName
	}
	return payload.DisplayName
}
