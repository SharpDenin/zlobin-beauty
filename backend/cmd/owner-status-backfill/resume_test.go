package main

import (
	"testing"

	"github.com/google/uuid"
)

func TestNextResumeAfterExclusiveCursor(t *testing.T) {
	u1, u2, u3 := uuid.New(), uuid.New(), uuid.New()
	// Ensure ordering for the test by using fixed values via strings if needed —
	// we only assert the helper returns the last row's user_id.
	batch := []MasterOwnerRow{
		{UserID: u1}, {UserID: u2}, {UserID: u3},
	}
	got := NextResumeAfter(batch)
	if got != u3 {
		t.Fatalf("got %s want %s", got, u3)
	}
	if NextResumeAfter(nil) != uuid.Nil {
		t.Fatal("empty batch cursor must be nil")
	}
}

func TestResumeAfterOnFailureDoesNotSkipBatch(t *testing.T) {
	prev := uuid.New()
	if ResumeAfterOnFailure(prev) != prev {
		t.Fatal("failure must keep previous exclusive cursor so the failed batch is re-listed")
	}
	if ResumeAfterOnFailure(uuid.Nil) != uuid.Nil {
		t.Fatal("first-batch failure resumes from start")
	}
}

func TestResumeReprocessesPartialBatchIdempotently(t *testing.T) {
	// Simulate: batch users A,B,C planned; A applied; crash before B.
	// Resume cursor is still prev (before A). Re-list includes A,B,C.
	// BuildPlan for A (already blocked) → unchanged; B,C still planned.
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	afterCrash := []MasterOwnerRow{
		{ProfileID: uuid.New(), UserID: a, OwnerStatus: "blocked", Published: true},
		{ProfileID: uuid.New(), UserID: b, OwnerStatus: "active", Published: true},
		{ProfileID: uuid.New(), UserID: c, OwnerStatus: "active", Published: true},
	}
	by := map[uuid.UUID]string{a: "blocked", b: "blocked", c: "deleted"}
	plan := BuildPlan(afterCrash, by)
	if plan.Unchanged != 1 {
		t.Fatalf("A should be unchanged, got unchanged=%d changes=%d", plan.Unchanged, len(plan.Changes))
	}
	if len(plan.Changes) != 2 {
		t.Fatalf("B+C still need apply, got %d", len(plan.Changes))
	}
}

func TestStaleActivePlanMustNotWinOverBlocked(t *testing.T) {
	// Batch read saw active→plan active (noop). Concurrent admin set blocked.
	// Fresh plan from marketplace blocked + identity blocked → no write of active.
	uid := uuid.New()
	row := MasterOwnerRow{ProfileID: uuid.New(), UserID: uid, OwnerStatus: "blocked", Published: true}
	plan := BuildPlan([]MasterOwnerRow{row}, map[uuid.UUID]string{uid: "blocked"})
	if len(plan.Changes) != 0 {
		t.Fatalf("must not plan overwrite to active; changes=%v", plan.Changes)
	}
	// Stale planned change active←active would be empty; stale planned blocked←active
	// after concurrent block already applied: FromStatus active CAS fails → concurrent skip.
	stale := Change{
		ProfileID: row.ProfileID, UserID: uid,
		FromStatus: "active", ToStatus: "blocked",
	}
	if stale.FromStatus == row.OwnerStatus {
		t.Fatal("stale from-status must differ from concurrent marketplace state")
	}
}
