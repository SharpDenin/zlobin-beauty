package service

import (
	"testing"
	"time"
)

func TestRecurringDatesWeekly(t *testing.T) {
	start := mustDate("2026-08-17") // Monday
	until := mustDate("2026-09-01")
	wd := 1
	got := recurringDates(start, "weekly", 1, &wd, until)
	if len(got) < 2 {
		t.Fatalf("expected several weekly dates, got %d", len(got))
	}
}

func mustDate(s string) time.Time {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		panic(err)
	}
	return t
}
