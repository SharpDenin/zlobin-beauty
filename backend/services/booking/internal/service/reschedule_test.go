package service

import (
	"testing"
	"time"

	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func slotAt(day time.Time, hour, minute int) Slot {
	st := time.Date(day.Year(), day.Month(), day.Day(), hour, minute, 0, 0, time.UTC)
	return Slot{StartsAt: st, EndsAt: st.Add(60 * time.Minute)}
}

func TestCollectRescheduleSlotsSkipsCurrentSortsAndDedupes(t *testing.T) {
	d1 := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	d2 := time.Date(2026, 9, 2, 0, 0, 0, 0, time.UTC)
	d3 := time.Date(2026, 9, 3, 0, 0, 0, 0, time.UTC)
	current := slotAt(d1, 14, 0).StartsAt
	perDay := [][]Slot{
		{slotAt(d1, 14, 0), slotAt(d1, 16, 0), slotAt(d1, 16, 0), slotAt(d1, 17, 30)},
		{slotAt(d2, 11, 0), slotAt(d2, 13, 30)},
		{slotAt(d3, 10, 0), slotAt(d3, 15, 0)},
	}

	got := CollectRescheduleSlots(current, perDay, 6)
	if len(got) != 6 {
		t.Fatalf("len=%d want 6: %+v", len(got), got)
	}
	if got[0].StartsAt.Hour() != 16 || got[0].StartsAt.Minute() != 0 {
		t.Fatalf("first slot = %s, want 16:00", got[0].StartsAt)
	}
	seen := map[int64]struct{}{}
	for i, s := range got {
		if s.StartsAt.Equal(current) {
			t.Fatal("current appointment start must not appear")
		}
		key := s.StartsAt.UnixNano()
		if _, ok := seen[key]; ok {
			t.Fatalf("duplicate at %d", i)
		}
		seen[key] = struct{}{}
		if i > 0 && !got[i].StartsAt.After(got[i-1].StartsAt) {
			t.Fatalf("not sorted: %s then %s", got[i-1].StartsAt, s.StartsAt)
		}
	}
}

func TestCollectRescheduleSlotsEmptyAndLimit(t *testing.T) {
	if slots := CollectRescheduleSlots(time.Now(), nil, 6); len(slots) != 0 {
		t.Fatalf("empty input: %+v", slots)
	}
	st := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	one := [][]Slot{{{StartsAt: st, EndsAt: st.Add(time.Hour)}}}
	got := CollectRescheduleSlots(st.Add(-time.Hour), one, 6)
	if len(got) != 1 {
		t.Fatalf("want the only available slot, got %d", len(got))
	}
	if n := CollectRescheduleSlots(st, one, 6); len(n) != 0 {
		t.Fatal("only-current must yield no suggestions")
	}
}

func TestCollectRescheduleSlotsDoesNotInventBusyTimes(t *testing.T) {
	d1 := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	free := slotAt(d1, 17, 0)
	// 16:00 is occupied / outside hours, so FreeSlots omitted it.
	got := CollectRescheduleSlots(slotAt(d1, 10, 0).StartsAt, [][]Slot{{free}}, 6)
	if len(got) != 1 || !got[0].StartsAt.Equal(free.StartsAt) {
		t.Fatalf("got %+v", got)
	}
}

func TestContainsSlotStart(t *testing.T) {
	d1 := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	slots := []Slot{slotAt(d1, 16, 0), slotAt(d1, 17, 30)}
	if !ContainsSlotStart(slots, slotAt(d1, 16, 0).StartsAt) {
		t.Fatal("free slot must match")
	}
	if ContainsSlotStart(slots, slotAt(d1, 15, 0).StartsAt) {
		t.Fatal("busy / unlisted time must not match")
	}
	moscow := slotAt(d1, 16, 0).StartsAt.In(time.FixedZone("MSK", 3*3600))
	if !ContainsSlotStart(slots, moscow) {
		t.Fatal("same instant in another offset must still match")
	}
}

func TestCollectRescheduleSlotsRespectsLimitForHasMore(t *testing.T) {
	d1 := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	d2 := time.Date(2026, 9, 2, 0, 0, 0, 0, time.UTC)
	perDay := [][]Slot{
		{slotAt(d1, 16, 0), slotAt(d1, 17, 30)},
		{slotAt(d2, 11, 0), slotAt(d2, 13, 30), slotAt(d2, 15, 0)},
	}
	current := slotAt(d1, 10, 0).StartsAt
	if n := CollectRescheduleSlots(current, perDay, 6); n == nil || len(n) != 5 {
		t.Fatalf("want all 5 available, got %d", len(n))
	}
	probe := CollectRescheduleSlots(current, perDay, 3+1)
	if len(probe) != 4 {
		t.Fatalf("limit+1 probe want 4, got %d", len(probe))
	}
	if len(CollectRescheduleSlots(current, perDay, 3)) != 3 {
		t.Fatal("limit 3 must truncate")
	}
}

func TestRescheduleEligibility(t *testing.T) {
	ok := &domain.Appointment{Status: domain.StatusConfirmed, BookingMode: domain.BookingModeFlexible}
	if err := rescheduleEligibility(ok); err != nil {
		t.Fatal(err)
	}
	fixed := &domain.Appointment{Status: domain.StatusConfirmed, BookingMode: domain.BookingModeFixedWindow}
	if err := rescheduleEligibility(fixed); err == nil {
		t.Fatal("expected fixed window error")
	} else if ae, _ := apperr.As(err); ae.Code != apperr.CodeAppointmentNotReschedulable {
		t.Fatalf("code=%s", ae.Code)
	}
	done := &domain.Appointment{Status: domain.StatusCompleted, BookingMode: domain.BookingModeFlexible}
	if err := rescheduleEligibility(done); err == nil {
		t.Fatal("expected completed error")
	} else if ae, _ := apperr.As(err); ae.Code != apperr.CodeAppointmentStatusInvalid {
		t.Fatalf("code=%s", ae.Code)
	}
	if err := rescheduleEligibility(nil); err == nil {
		t.Fatal("expected not found")
	}
	cancelled := &domain.Appointment{Status: domain.StatusCancelledByClient, BookingMode: domain.BookingModeFlexible}
	if err := rescheduleEligibility(cancelled); err == nil {
		t.Fatal("expected cancelled error")
	} else if ae, _ := apperr.As(err); ae.Code != apperr.CodeAppointmentStatusInvalid {
		t.Fatalf("code=%s", ae.Code)
	}
}
