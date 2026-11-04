package domain

import (
	"testing"
	"time"
)

func TestIntervalsOverlap(t *testing.T) {
	base := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	a0, a1 := base, base.Add(2*time.Hour)
	b0, b1 := base.Add(time.Hour), base.Add(3*time.Hour)
	if !IntervalsOverlap(a0, a1, b0, b1) {
		t.Fatal("partial overlap expected")
	}
	if !IntervalsOverlap(a0, a1, a0, a1) {
		t.Fatal("identical intervals overlap")
	}
	// Same start different end
	if !IntervalsOverlap(a0, a1, a0, a1.Add(time.Hour)) {
		t.Fatal("same start must overlap")
	}
	// Same end different start
	if !IntervalsOverlap(a0, a1, a0.Add(-time.Hour), a1) {
		t.Fatal("same end must overlap")
	}
	// Touching endpoints — no overlap
	c0, c1 := a1, a1.Add(time.Hour)
	if IntervalsOverlap(a0, a1, c0, c1) {
		t.Fatal("endA == startB must not overlap")
	}
	if IntervalsOverlap(c0, c1, a0, a1) {
		t.Fatal("endB == startA must not overlap")
	}
	// Disjoint
	d0, d1 := a1.Add(time.Hour), a1.Add(2*time.Hour)
	if IntervalsOverlap(a0, a1, d0, d1) {
		t.Fatal("disjoint must not overlap")
	}
}

func TestIntervalsOverlapTimezoneNormalized(t *testing.T) {
	krsk := time.FixedZone("KRSK", 7*3600)
	start := time.Date(2026, 9, 15, 11, 0, 0, 0, krsk)
	end := start.Add(2 * time.Hour)
	otherStart := start.UTC().Add(30 * time.Minute)
	otherEnd := end.UTC().Add(30 * time.Minute)
	if !IntervalsOverlap(start.UTC(), end.UTC(), otherStart, otherEnd) {
		t.Fatal("TIMESTAMPTZ-normalized intervals must overlap")
	}
	touchStart := end.UTC()
	touchEnd := end.UTC().Add(time.Hour)
	if IntervalsOverlap(start.UTC(), end.UTC(), touchStart, touchEnd) {
		t.Fatal("touching endpoints must be allowed across TZ")
	}
}
