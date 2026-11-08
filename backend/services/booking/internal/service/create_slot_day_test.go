package service

import (
	"testing"
	"time"
)

// Documents the Create/Reschedule contract: FreeSlots must receive the salon-local
// calendar date, not the UTC wall-clock Y/M/D of starts_at.
func TestLocalCalendarDayFromStartsAt(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Moscow")
	if err != nil {
		t.Fatal(err)
	}
	// 01:00 Moscow on March 15 == 22:00 UTC on March 14.
	startsUTC := time.Date(2026, 3, 14, 22, 0, 0, 0, time.UTC)
	local := startsUTC.In(loc)
	if local.Year() != 2026 || local.Month() != time.March || local.Day() != 15 {
		t.Fatalf("local day = %v, want 2026-03-15", local)
	}
	utcWall := startsUTC
	if utcWall.Day() == local.Day() {
		t.Fatal("fixture must differ between UTC wall day and Moscow local day")
	}
}

func TestContainsSlotStartIgnoresLocationLabel(t *testing.T) {
	moscow, err := time.LoadLocation("Europe/Moscow")
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 3, 15, 10, 0, 0, 0, moscow)
	slots := []Slot{{StartsAt: start.UTC(), EndsAt: start.UTC().Add(time.Hour)}}
	if !ContainsSlotStart(slots, start) {
		t.Fatal("expected match across equal instants with different Location")
	}
	if ContainsSlotStart(slots, start.Add(30*time.Minute)) {
		t.Fatal("unexpected match for different start")
	}
}
