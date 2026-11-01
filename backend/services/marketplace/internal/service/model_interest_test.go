package service

import (
	"testing"
	"time"

	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
)

func TestModelInterestOverlapRule(t *testing.T) {
	start := time.Date(2026, 9, 15, 11, 0, 0, 0, time.FixedZone("KRSK", 7*3600))
	end := start.Add(2 * time.Hour)
	otherStart := start.UTC().Add(30 * time.Minute)
	otherEnd := end.UTC().Add(30 * time.Minute)
	if !domain.IntervalsOverlap(start.UTC(), end.UTC(), otherStart, otherEnd) {
		t.Fatal("TZ-normalized intervals must overlap")
	}
	touchStart := end.UTC()
	touchEnd := end.UTC().Add(time.Hour)
	if domain.IntervalsOverlap(start.UTC(), end.UTC(), touchStart, touchEnd) {
		t.Fatal("touching endpoints must be allowed")
	}
}
