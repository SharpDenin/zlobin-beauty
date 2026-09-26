package domain

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestSelectRepeatSource(t *testing.T) {
	svcA := uuid.MustParse("00000000-0000-0000-0000-00000000000a")
	svcB := uuid.MustParse("00000000-0000-0000-0000-00000000000b")
	id1 := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	id2 := uuid.MustParse("00000000-0000-0000-0000-000000000002")
	id3 := uuid.MustParse("00000000-0000-0000-0000-000000000003")
	t0 := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)
	t1 := t0.Add(24 * time.Hour)
	t2 := t0.Add(48 * time.Hour)

	got := SelectRepeatSource([]RepeatCandidate{
		{ID: id1, ServiceID: svcA, StartsAt: t0, HasScheme: true},
		{ID: id2, ServiceID: svcB, StartsAt: t2, HasScheme: true},
		{ID: id3, ServiceID: svcA, StartsAt: t1, HasScheme: true},
	}, svcA)
	if got == nil || got.ID != id3 {
		t.Fatalf("prefer same service newest, got %+v", got)
	}

	got = SelectRepeatSource([]RepeatCandidate{
		{ID: id1, ServiceID: svcA, StartsAt: t2, HasScheme: false},
		{ID: id2, ServiceID: svcA, StartsAt: t1, HasScheme: true, Skipped: false},
	}, uuid.Nil)
	if got == nil || got.ID != id2 {
		t.Fatalf("prefer stored scheme over newer without scheme, got %+v", got)
	}

	got = SelectRepeatSource([]RepeatCandidate{
		{ID: id1, ServiceID: svcA, StartsAt: t2, HasScheme: true, Skipped: true},
		{ID: id2, ServiceID: svcA, StartsAt: t1, HasScheme: true, Skipped: false},
	}, uuid.Nil)
	if got == nil || got.ID != id2 {
		t.Fatalf("prefer non-skipped scheme over newer skipped, got %+v", got)
	}

	got = SelectRepeatSource([]RepeatCandidate{
		{ID: id1, ServiceID: svcA, StartsAt: t0, HasScheme: true, UpdatedAt: t2},
		{ID: id2, ServiceID: svcA, StartsAt: t2, HasScheme: true, UpdatedAt: t0},
	}, uuid.Nil)
	if got == nil || got.ID != id1 {
		t.Fatalf("prefer completion recency over scheduled start, got %+v", got)
	}

	if SelectRepeatSource(nil, uuid.Nil) != nil {
		t.Fatal("empty should be nil")
	}
}
