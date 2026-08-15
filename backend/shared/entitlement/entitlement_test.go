package entitlement

import (
	"testing"
	"time"
)

func TestEvaluateTrialActive(t *testing.T) {
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	end := now.Add(24 * time.Hour)
	snap := Evaluate(PlanPremium, StatusTrial, &end, nil, now)
	if !snap.IsPremium() {
		t.Fatal("expected premium during trial")
	}
	if !snap.Has(FeatureSkipServiceScheme) {
		t.Fatal("premium should skip scheme")
	}
}

func TestEvaluateTrialExpiredBecomesFree(t *testing.T) {
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	end := now.Add(-time.Hour)
	snap := Evaluate(PlanPremium, StatusTrial, &end, nil, now)
	if snap.IsPremium() {
		t.Fatal("expired trial must not be premium")
	}
	if snap.Status != StatusExpired {
		t.Fatalf("status=%s", snap.Status)
	}
	if snap.Has(FeatureSkipServiceScheme) {
		t.Fatal("free must not skip scheme")
	}
}

func TestEvaluatePaidPremium(t *testing.T) {
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	paid := now.Add(30 * 24 * time.Hour)
	snap := Evaluate(PlanPremium, StatusActive, nil, &paid, now)
	if !snap.IsPremium() {
		t.Fatal("expected paid premium")
	}
}

func TestTrialForNewUser(t *testing.T) {
	now := time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC)
	plan, status, start, end := TrialForNewUser(now)
	if plan != PlanPremium || status != StatusTrial {
		t.Fatalf("%s %s", plan, status)
	}
	if !start.Equal(now.UTC()) {
		t.Fatal("trial start")
	}
	want := now.UTC().AddDate(0, 3, 0)
	if !end.Equal(want) {
		t.Fatalf("trial end %s want %s", end, want)
	}
}
