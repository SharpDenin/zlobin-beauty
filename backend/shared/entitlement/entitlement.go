package entitlement

import (
	"time"
)

const (
	PlanFree    = "free"
	PlanPremium = "premium"

	StatusTrial     = "trial"
	StatusActive    = "active"
	StatusExpired   = "expired"
	StatusCancelled = "cancelled"

	FeatureSkipServiceScheme = "skip_service_scheme"
	FeatureAdvancedAnalytics = "advanced_analytics"
)

type Snapshot struct {
	Plan           string     `json:"plan"`
	Status         string     `json:"status"`
	TrialStartedAt *time.Time `json:"trial_started_at,omitempty"`
	TrialEndsAt    *time.Time `json:"trial_ends_at,omitempty"`
	StartedAt      *time.Time `json:"started_at,omitempty"`
	PaidUntil      *time.Time `json:"paid_until,omitempty"`
	CancelledAt    *time.Time `json:"cancelled_at,omitempty"`
	EffectivePlan  string     `json:"effective_plan"`
	Features       []string   `json:"features"`
}

func (s Snapshot) Has(feature string) bool {
	for _, f := range s.Features {
		if f == feature {
			return true
		}
	}
	return false
}

func (s Snapshot) IsPremium() bool {
	return s.EffectivePlan == PlanPremium
}

func CanSkipServiceScheme(snap Snapshot) bool {
	return snap.Has(FeatureSkipServiceScheme)
}

// ResolveEffectivePlan is the single entry point for subscription-derived access.
func ResolveEffectivePlan(plan, status string, trialEnds, paidUntil *time.Time, now time.Time) Snapshot {
	return Evaluate(plan, status, trialEnds, paidUntil, now)
}

// IsProfessionalSubscriber returns true when the user role set includes a billable professional role.
func IsProfessionalSubscriber(roles []string) bool {
	pro := map[string]struct{}{
		"master": {}, "supplier": {}, "supplier_rep": {}, "salon_admin": {}, "salon_owner": {},
	}
	for _, r := range roles {
		if _, ok := pro[r]; ok {
			return true
		}
	}
	return false
}

func Evaluate(plan, status string, trialEnds, paidUntil *time.Time, now time.Time) Snapshot {
	snap := Snapshot{Plan: plan, Status: status, EffectivePlan: PlanFree}
	if plan == "" {
		snap.Plan = PlanFree
	}
	premium := false
	switch status {
	case StatusTrial:
		if trialEnds != nil && now.Before(*trialEnds) {
			premium = true
		}
	case StatusActive:
		if paidUntil == nil || now.Before(*paidUntil) || now.Equal(*paidUntil) {
			premium = true
		}
	}
	if premium {
		snap.EffectivePlan = PlanPremium
		snap.Features = []string{FeatureSkipServiceScheme}
	} else {
		snap.EffectivePlan = PlanFree
		snap.Features = []string{}
		if status == StatusTrial || status == StatusActive {
			snap.Status = StatusExpired
		}
	}
	return snap
}

func TrialForNewUser(now time.Time) (plan, status string, trialStart, trialEnd time.Time) {
	start := now.UTC()
	return PlanPremium, StatusTrial, start, start.AddDate(0, 3, 0)
}
