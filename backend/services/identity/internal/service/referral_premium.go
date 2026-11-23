package service

import (
	"time"

	"github.com/zlobin/zlobin-beauty/backend/shared/entitlement"
)

// computePremiumExtend applies referral (+N months) rules without shortening existing windows.
// Trial stays trial; active paid extends paid_until; otherwise grants active paid from now.
func computePremiumExtend(plan, status string, trialEnds, paidUntil *time.Time, now time.Time, months int) (newPlan, newStatus string, newTrialEnds, newPaidUntil *time.Time, clearCancelled bool) {
	if months <= 0 {
		months = 3
	}
	now = now.UTC()
	newPlan, newStatus = plan, status
	newTrialEnds, newPaidUntil = cloneTime(trialEnds), cloneTime(paidUntil)

	trialActive := status == entitlement.StatusTrial && trialEnds != nil && trialEnds.After(now)
	paidActive := status == entitlement.StatusActive && (paidUntil == nil || !paidUntil.Before(now))

	switch {
	case trialActive:
		base := *trialEnds
		if base.Before(now) {
			base = now
		}
		end := base.AddDate(0, months, 0)
		newTrialEnds = &end
		newPlan = entitlement.PlanPremium
		newStatus = entitlement.StatusTrial
	case paidActive:
		base := now
		if paidUntil != nil && paidUntil.After(now) {
			base = *paidUntil
		}
		end := base.AddDate(0, months, 0)
		newPaidUntil = &end
		newPlan = entitlement.PlanPremium
		newStatus = entitlement.StatusActive
		clearCancelled = true
	default:
		end := now.AddDate(0, months, 0)
		newPaidUntil = &end
		newPlan = entitlement.PlanPremium
		newStatus = entitlement.StatusActive
		clearCancelled = true
	}
	return
}

func cloneTime(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	v := t.UTC()
	return &v
}
