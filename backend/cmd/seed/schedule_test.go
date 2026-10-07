package main

import (
	"testing"
	"time"
)

func TestDemoWorkingDaysIncludesTodayOnWeekday(t *testing.T) {
	loc := time.FixedZone("test", 7*3600)
	friday := time.Date(2026, 10, 2, 23, 41, 0, 0, loc)
	days := demoWorkingDays(friday, 5)
	if len(days) != 5 {
		t.Fatalf("len=%d", len(days))
	}
	if days[0].Day() != 2 || days[0].Month() != time.October {
		t.Fatalf("today should be first working day, got %s", days[0].Format("2006-01-02"))
	}
	for _, d := range days {
		if d.Weekday() == time.Saturday || d.Weekday() == time.Sunday {
			t.Fatalf("weekend leaked: %s", d.Format("2006-01-02"))
		}
	}
}

func TestDemoHorizonReaches31CalendarDays(t *testing.T) {
	start := time.Date(2026, 10, 7, 18, 0, 0, 0, time.UTC) // Wednesday
	days := demoHorizonDays(start, 31)
	if len(days) == 0 {
		t.Fatal("empty horizon")
	}
	last := days[len(days)-1]
	minLast := time.Date(start.Year(), start.Month(), start.Day(), 12, 0, 0, 0, time.UTC).AddDate(0, 0, 31)
	if last.Before(minLast) {
		t.Fatalf("last booking %s is before %s", last.Format("2006-01-02"), minLast.Format("2006-01-02"))
	}
	for _, d := range days {
		if d.Weekday() == time.Saturday || d.Weekday() == time.Sunday {
			t.Fatalf("weekend leaked: %s", d.Format("2006-01-02"))
		}
	}
}

func TestDemoWorkingDaysSkipsWeekendAnchor(t *testing.T) {
	loc := time.FixedZone("test", 7*3600)
	saturday := time.Date(2026, 10, 3, 10, 0, 0, 0, loc)
	days := demoWorkingDays(saturday, 3)
	if len(days) != 3 {
		t.Fatalf("len=%d", len(days))
	}
	if days[0].Weekday() != time.Monday || days[0].Day() != 5 {
		t.Fatalf("expected Monday 5 Oct, got %s %s", days[0].Weekday(), days[0].Format("2006-01-02"))
	}
}
