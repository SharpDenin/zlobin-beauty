package service

import (
	"testing"
	"time"

	"github.com/zlobin/zlobin-beauty/backend/shared/entitlement"
)

func TestComputePremiumExtend(t *testing.T) {
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)

	t.Run("active paid extends without shortening", func(t *testing.T) {
		paid := now.AddDate(0, 2, 0)
		plan, status, trial, paidOut, _ := computePremiumExtend(entitlement.PlanPremium, entitlement.StatusActive, nil, &paid, now, 3)
		if plan != entitlement.PlanPremium || status != entitlement.StatusActive {
			t.Fatalf("got %s/%s", plan, status)
		}
		if trial != nil {
			t.Fatal("trial should stay nil")
		}
		want := paid.AddDate(0, 3, 0)
		if paidOut == nil || !paidOut.Equal(want) {
			t.Fatalf("paid_until=%v want %v", paidOut, want)
		}
	})

	t.Run("trial extends as trial", func(t *testing.T) {
		ends := now.AddDate(0, 1, 0)
		plan, status, trial, paidOut, _ := computePremiumExtend(entitlement.PlanPremium, entitlement.StatusTrial, &ends, nil, now, 3)
		if plan != entitlement.PlanPremium || status != entitlement.StatusTrial {
			t.Fatalf("got %s/%s", plan, status)
		}
		if paidOut != nil {
			t.Fatal("must not convert trial to paid")
		}
		want := ends.AddDate(0, 3, 0)
		if trial == nil || !trial.Equal(want) {
			t.Fatalf("trial_ends=%v want %v", trial, want)
		}
	})

	t.Run("expired grants three months from now", func(t *testing.T) {
		past := now.AddDate(0, -1, 0)
		plan, status, _, paidOut, _ := computePremiumExtend(entitlement.PlanFree, entitlement.StatusExpired, &past, &past, now, 3)
		if plan != entitlement.PlanPremium || status != entitlement.StatusActive {
			t.Fatalf("got %s/%s", plan, status)
		}
		want := now.AddDate(0, 3, 0)
		if paidOut == nil || !paidOut.Equal(want) {
			t.Fatalf("paid_until=%v want %v", paidOut, want)
		}
	})

	t.Run("lapsed trial grants paid from now", func(t *testing.T) {
		past := now.AddDate(0, -1, 0)
		plan, status, _, paidOut, _ := computePremiumExtend(entitlement.PlanPremium, entitlement.StatusTrial, &past, nil, now, 3)
		if status != entitlement.StatusActive || plan != entitlement.PlanPremium {
			t.Fatalf("got %s/%s", plan, status)
		}
		want := now.AddDate(0, 3, 0)
		if paidOut == nil || !paidOut.Equal(want) {
			t.Fatalf("paid_until=%v want %v", paidOut, want)
		}
	})
}
