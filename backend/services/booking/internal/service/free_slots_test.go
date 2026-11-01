package service

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/store"
)

func TestComputeFreeSlotsDayOffWindowsEmpty(t *testing.T) {
	loc, _ := time.LoadLocation("Europe/Moscow")
	day := time.Date(2026, 11, 10, 0, 0, 0, 0, loc)
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	got := computeFreeSlots(day, nil, 60, now, nil, uuid.Nil, nil, nil)
	if len(got) != 0 {
		t.Fatalf("day-off / empty windows must yield [], got %d", len(got))
	}
}

func TestComputeFreeSlotsWeeklyHoursAndStep(t *testing.T) {
	loc, _ := time.LoadLocation("Europe/Moscow")
	day := time.Date(2026, 11, 10, 0, 0, 0, 0, loc) // Tuesday
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	// 10:00–12:00 local → 4 half-hour starts for 60-min service: 10:00, 10:30, 11:00
	windows := []freeSlotWindow{{start: 10 * 60, end: 12 * 60}}
	got := computeFreeSlots(day, windows, 60, now, nil, uuid.Nil, nil, nil)
	if len(got) != 3 {
		t.Fatalf("want 3 slots for 60m in 2h window, got %d: %+v", len(got), got)
	}
	first := got[0].StartsAt.In(loc)
	if first.Hour() != 10 || first.Minute() != 0 {
		t.Fatalf("first slot=%v want 10:00 local", first)
	}
	// 11:30 start would end at 12:30 — outside window
	for _, s := range got {
		local := s.StartsAt.In(loc)
		if local.Hour() == 11 && local.Minute() == 30 {
			t.Fatal("11:30 must not fit 60m into window ending 12:00")
		}
	}
}

func TestComputeFreeSlotsDurationDoesNotFit(t *testing.T) {
	loc, _ := time.LoadLocation("Europe/Moscow")
	day := time.Date(2026, 11, 10, 0, 0, 0, 0, loc)
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	windows := []freeSlotWindow{{start: 10 * 60, end: 10*60 + 45}}
	got := computeFreeSlots(day, windows, 60, now, nil, uuid.Nil, nil, nil)
	if len(got) != 0 {
		t.Fatalf("60m service in 45m window must be empty, got %d", len(got))
	}
}

func TestComputeFreeSlotsSkipsPast(t *testing.T) {
	loc, _ := time.LoadLocation("Europe/Moscow")
	day := time.Date(2026, 11, 10, 0, 0, 0, 0, loc)
	now := time.Date(2026, 11, 10, 10, 15, 0, 0, loc) // after 10:00
	windows := []freeSlotWindow{{start: 10 * 60, end: 11 * 60}}
	got := computeFreeSlots(day, windows, 30, now, nil, uuid.Nil, nil, nil)
	// 10:00 not after now; 10:30 ok
	if len(got) != 1 {
		t.Fatalf("want 1 future slot, got %d: %+v", len(got), got)
	}
	if got[0].StartsAt.In(loc).Minute() != 30 {
		t.Fatalf("slot=%v want :30", got[0].StartsAt.In(loc))
	}
}

func TestComputeFreeSlotsAppointmentBlocks(t *testing.T) {
	loc, _ := time.LoadLocation("Europe/Moscow")
	day := time.Date(2026, 11, 10, 0, 0, 0, 0, loc)
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	windows := []freeSlotWindow{{start: 10 * 60, end: 12 * 60}}
	busyStart := day.Add(10 * time.Hour).UTC()
	busy := []domain.Appointment{{
		ID:       uuid.New(),
		StartsAt: busyStart,
		EndsAt:   busyStart.Add(60 * time.Minute),
	}}
	got := computeFreeSlots(day, windows, 60, now, busy, uuid.Nil, nil, nil)
	for _, s := range got {
		if IntervalsOverlap(s.StartsAt, s.EndsAt, busy[0].StartsAt, busy[0].EndsAt) {
			t.Fatalf("slot %v overlaps busy appointment", s.StartsAt)
		}
	}
	if len(got) == 0 {
		t.Fatal("expected remaining free slots after appointment")
	}
}

func TestComputeFreeSlotsPlannerBlocks(t *testing.T) {
	loc, _ := time.LoadLocation("Europe/Moscow")
	day := time.Date(2026, 11, 10, 0, 0, 0, 0, loc)
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	windows := []freeSlotWindow{{start: 10 * 60, end: 12 * 60}}
	blockStart := day.Add(11 * time.Hour).UTC()
	blocks := []store.PlannerBlock{{
		ID:       uuid.New(),
		StartsAt: blockStart,
		EndsAt:   blockStart.Add(30 * time.Minute),
	}}
	got := computeFreeSlots(day, windows, 60, now, nil, uuid.Nil, blocks, nil)
	for _, s := range got {
		if IntervalsOverlap(s.StartsAt, s.EndsAt, blocks[0].StartsAt, blocks[0].EndsAt) {
			t.Fatalf("slot %v overlaps planner block", s.StartsAt)
		}
	}
}

func TestComputeFreeSlotsExcludeAppointmentID(t *testing.T) {
	loc, _ := time.LoadLocation("Europe/Moscow")
	day := time.Date(2026, 11, 10, 0, 0, 0, 0, loc)
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	windows := []freeSlotWindow{{start: 10 * 60, end: 11 * 60}}
	id := uuid.New()
	busyStart := day.Add(10 * time.Hour).UTC()
	busy := []domain.Appointment{{ID: id, StartsAt: busyStart, EndsAt: busyStart.Add(60 * time.Minute)}}
	without := computeFreeSlots(day, windows, 60, now, busy, uuid.Nil, nil, nil)
	withExclude := computeFreeSlots(day, windows, 60, now, busy, id, nil, nil)
	if len(without) != 0 {
		t.Fatalf("without exclude want 0, got %d", len(without))
	}
	if len(withExclude) != 1 {
		t.Fatalf("with exclude want 1 (self), got %d", len(withExclude))
	}
}

func TestComputeFreeSlotsWorkModeCovering(t *testing.T) {
	loc, _ := time.LoadLocation("Europe/Moscow")
	day := time.Date(2026, 11, 10, 0, 0, 0, 0, loc)
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	windows := []freeSlotWindow{{start: 10 * 60, end: 13 * 60}}
	// Work mode only covers 10:00–11:00 UTC-adjusted local
	modeStart := day.Add(10 * time.Hour).UTC()
	modes := []domain.WorkModeInterval{{
		Mode:     domain.WorkModeChair,
		StartsAt: modeStart,
		EndsAt:   modeStart.Add(60 * time.Minute),
	}}
	got := computeFreeSlots(day, windows, 60, now, nil, uuid.Nil, nil, modes)
	if len(got) != 1 {
		t.Fatalf("want single chair-covered 60m slot, got %d: %+v", len(got), got)
	}
	if got[0].WorkMode != domain.WorkModeChair {
		t.Fatalf("work_mode=%q want chair", got[0].WorkMode)
	}
}

func TestComputeFreeSlotsExceptionShortWindow(t *testing.T) {
	// Exception day with shortened hours is just a narrower window list.
	loc, _ := time.LoadLocation("Europe/Moscow")
	day := time.Date(2026, 11, 10, 0, 0, 0, 0, loc)
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	windows := []freeSlotWindow{{start: 14 * 60, end: 15 * 60}}
	got := computeFreeSlots(day, windows, 30, now, nil, uuid.Nil, nil, nil)
	if len(got) != 2 { // 14:00, 14:30
		t.Fatalf("want 2 slots, got %d", len(got))
	}
}
