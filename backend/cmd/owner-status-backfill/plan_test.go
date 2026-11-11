package main

import (
	"testing"

	"github.com/google/uuid"
)

func TestBuildPlanActiveUnchanged(t *testing.T) {
	uid := uuid.New()
	pid := uuid.New()
	plan := BuildPlan([]MasterOwnerRow{{
		ProfileID: pid, UserID: uid, OwnerStatus: "active", Published: true,
	}}, map[uuid.UUID]string{uid: "active"})
	if plan.Scanned != 1 || plan.Unchanged != 1 || len(plan.Changes) != 0 {
		t.Fatalf("%+v", plan)
	}
	if err := PlanBlocksApply(plan); err != nil {
		t.Fatal(err)
	}
}

func TestBuildPlanBlockedAndDeleted(t *testing.T) {
	blocked := uuid.New()
	deleted := uuid.New()
	plan := BuildPlan([]MasterOwnerRow{
		{ProfileID: uuid.New(), UserID: blocked, OwnerStatus: "active", Published: true},
		{ProfileID: uuid.New(), UserID: deleted, OwnerStatus: "active", Published: true},
	}, map[uuid.UUID]string{
		blocked: "blocked",
		deleted: "deleted",
	})
	if len(plan.Changes) != 2 {
		t.Fatalf("changes=%d", len(plan.Changes))
	}
	byUser := map[uuid.UUID]Change{}
	for _, c := range plan.Changes {
		byUser[c.UserID] = c
	}
	if byUser[blocked].ToStatus != "blocked" || byUser[blocked].ForceUnpub {
		t.Fatalf("blocked %#v", byUser[blocked])
	}
	if byUser[deleted].ToStatus != "deleted" || !byUser[deleted].ForceUnpub {
		t.Fatalf("deleted %#v", byUser[deleted])
	}
}

func TestBuildPlanMissingIdentityFailsClosed(t *testing.T) {
	uid := uuid.New()
	plan := BuildPlan([]MasterOwnerRow{{
		ProfileID: uuid.New(), UserID: uid, OwnerStatus: "active", Published: true,
	}}, map[uuid.UUID]string{})
	if len(plan.Missing) != 1 || plan.Missing[0] != uid {
		t.Fatalf("missing %#v", plan.Missing)
	}
	if err := PlanBlocksApply(plan); err == nil {
		t.Fatal("expected apply block")
	}
}

func TestBuildPlanUnknownStatusFailsClosed(t *testing.T) {
	uid := uuid.New()
	plan := BuildPlan([]MasterOwnerRow{{
		ProfileID: uuid.New(), UserID: uid, OwnerStatus: "active", Published: true,
	}}, map[uuid.UUID]string{uid: "suspended"})
	if len(plan.Unknown) != 1 || len(plan.Errors) == 0 {
		t.Fatalf("%+v", plan)
	}
	if err := PlanBlocksApply(plan); err == nil {
		t.Fatal("expected apply block")
	}
	// Must never invent active.
	for _, c := range plan.Changes {
		if c.ToStatus == "active" {
			t.Fatal("unknown must not become active")
		}
	}
}

func TestBuildPlanIdempotentRerun(t *testing.T) {
	uid := uuid.New()
	rows := []MasterOwnerRow{{
		ProfileID: uuid.New(), UserID: uid, OwnerStatus: "blocked", Published: true,
	}}
	by := map[uuid.UUID]string{uid: "blocked"}
	first := BuildPlan(rows, by)
	if len(first.Changes) != 0 || first.Unchanged != 1 {
		t.Fatalf("first %+v", first)
	}
	second := BuildPlan(rows, by)
	if len(second.Changes) != 0 || second.Unchanged != 1 {
		t.Fatalf("second %+v", second)
	}
}

func TestBuildPlanDeletedStillPublished(t *testing.T) {
	uid := uuid.New()
	plan := BuildPlan([]MasterOwnerRow{{
		ProfileID: uuid.New(), UserID: uid, OwnerStatus: "deleted", Published: true,
	}}, map[uuid.UUID]string{uid: "deleted"})
	if len(plan.Changes) != 1 || !plan.Changes[0].ForceUnpub {
		t.Fatalf("%+v", plan)
	}
}

func TestNormalizeIdentityStatus(t *testing.T) {
	for _, s := range []string{"active", "Blocked", " DELETED "} {
		if _, err := normalizeIdentityStatus(s); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := normalizeIdentityStatus("nope"); err == nil {
		t.Fatal("expected error")
	}
}
