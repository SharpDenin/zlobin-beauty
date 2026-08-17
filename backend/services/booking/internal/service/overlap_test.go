package service

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/store"
)

func TestIntervalsOverlap(t *testing.T) {
	base := time.Date(2026, 8, 10, 10, 0, 0, 0, time.UTC)
	at := func(min int) time.Time { return base.Add(time.Duration(min) * time.Minute) }

	cases := []struct {
		name               string
		a0, a1, b0, b1 int
		want               bool
	}{
		{"identical", 0, 60, 0, 60, true},
		{"partial overlap start", 0, 60, 30, 90, true},
		{"partial overlap end", 30, 90, 0, 60, true},
		{"contained", 0, 120, 30, 60, true},
		{"back to back allowed", 0, 60, 60, 120, false},
		{"back to back reverse", 60, 120, 0, 60, false},
		{"disjoint before", 0, 30, 60, 90, false},
		{"disjoint after", 60, 90, 0, 30, false},
		{"touching by one minute overlap", 0, 61, 60, 120, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := IntervalsOverlap(at(tc.a0), at(tc.a1), at(tc.b0), at(tc.b1))
			if got != tc.want {
				t.Fatalf("IntervalsOverlap = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestAppointmentBlocksSlotExcludesSelf(t *testing.T) {
	selfID := uuid.Must(uuid.NewV7())
	otherID := uuid.Must(uuid.NewV7())
	start := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	end := start.Add(60 * time.Minute)

	existing := []domain.Appointment{
		{ID: selfID, StartsAt: start, EndsAt: end},
		{ID: otherID, StartsAt: start.Add(2 * time.Hour), EndsAt: start.Add(3 * time.Hour)},
	}

	// Without exclude: own appointment blocks the slot.
	if !appointmentBlocksSlot(existing, uuid.Nil, start, end) {
		t.Fatal("expected self appointment to block when not excluded")
	}
	// With exclude: moving within own slot is allowed.
	if appointmentBlocksSlot(existing, selfID, start, end) {
		t.Fatal("expected excludeAppointmentID to ignore self")
	}
	// Other appointment still blocks overlapping time.
	otherStart := start.Add(2 * time.Hour)
	otherEnd := otherStart.Add(60 * time.Minute)
	if !appointmentBlocksSlot(existing, selfID, otherStart, otherEnd) {
		t.Fatal("expected other appointment to still block")
	}
	// Back-to-back after self is free.
	if appointmentBlocksSlot(existing, selfID, end, end.Add(60*time.Minute)) {
		t.Fatal("back-to-back after excluded self should not block")
	}
}

func TestPlannerBlocksSlotOccupiesFreeTime(t *testing.T) {
	id := uuid.Must(uuid.NewV7())
	start := time.Date(2026, 8, 10, 13, 0, 0, 0, time.UTC)
	end := start.Add(60 * time.Minute)
	blocks := []store.PlannerBlock{{ID: id, StartsAt: start, EndsAt: end}}
	if !plannerBlocksSlot(blocks, uuid.Nil, start, end) {
		t.Fatal("lunch block must occupy the slot")
	}
	if plannerBlocksSlot(blocks, id, start, end) {
		t.Fatal("excluded block must not occupy")
	}
	if plannerBlocksSlot(blocks, uuid.Nil, end, end.Add(30*time.Minute)) {
		t.Fatal("back-to-back after planner block must stay free")
	}
}

func TestCanDragAppointment(t *testing.T) {
	if !CanDragAppointment(domain.StatusConfirmed, domain.BookingModeFlexible) {
		t.Fatal("confirmed flexible must be draggable")
	}
	if CanDragAppointment(domain.StatusCompleted, domain.BookingModeFlexible) {
		t.Fatal("completed must not be draggable")
	}
	if CanDragAppointment(domain.StatusCancelledByClient, "") {
		t.Fatal("cancelled must not be draggable")
	}
	if CanDragAppointment(domain.StatusNoShow, "") {
		t.Fatal("no-show must not be draggable")
	}
	if CanDragAppointment(domain.StatusConfirmed, domain.BookingModeFixedWindow) {
		t.Fatal("fixed window must not be draggable")
	}
}
