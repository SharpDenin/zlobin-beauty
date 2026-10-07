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

func TestDemoWorkingDaysCoversAMonth(t *testing.T) {
	start := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC) // Monday
	days := demoWorkingDays(start, 23)
	if len(days) != 23 {
		t.Fatalf("len=%d", len(days))
	}
	span := days[len(days)-1].Sub(days[0])
	if span < 30*24*time.Hour {
		t.Fatalf("working days do not reach a month ahead: %s", span)
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
