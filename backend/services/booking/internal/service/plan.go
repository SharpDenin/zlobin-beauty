package service

import (
	"sort"
	"time"

	"github.com/google/uuid"
)

const (
	DefaultPlanLimit     = 6
	MaxPlanLimit         = 12
	PlanHorizonDays      = 7
	MaxMastersPerService = 4
	MaxWaitMinutes       = 90
	maxSlotsPerMasterDay = 8
)

type PlanCandidate struct {
	MasterID          uuid.UUID
	MasterUserID      uuid.UUID
	MasterDisplayName string
	OrganizationID    uuid.UUID
	BranchID          uuid.UUID
	Published         bool
}

type PlanService struct {
	ID              uuid.UUID
	Name            string
	Category        string
	DurationMinutes int
	PriceMinor      int64
	Currency        string
	OrganizationID  uuid.UUID
	BookingMode     string
	Masters         []PlanCandidate
}

type VisitLeg struct {
	ServiceID         uuid.UUID
	ServiceName       string
	MasterID          uuid.UUID
	MasterUserID      uuid.UUID
	MasterDisplayName string
	StartsAt          time.Time
	EndsAt            time.Time
	DurationMinutes   int
	PriceMinor        int64
	Currency          string
	WorkMode          string
}

type VisitPlan struct {
	Legs         []VisitLeg
	WaitMinutes  int
	TotalMinutes int
	StartsAt     time.Time
	EndsAt       time.Time
	SameMaster   bool
	Reason       string
}

type slotKey struct {
	Master uuid.UUID
	Day    string
	Dur    int
}

func slotDayKey(day time.Time) string {
	return day.Format("2006-01-02")
}

// AssembleVisitPlans builds sequential two-service plans from FreeSlots results.
// Priority: all legs feasible → no overlap → procedure order already applied by caller →
// minimum waiting time → shorter visit span → nearest start. Search is bounded
// (horizon, masters per service, slots per day).
func AssembleVisitPlans(order []PlanService, perKey map[slotKey][]Slot, days []time.Time, limit int) []VisitPlan {
	if limit <= 0 {
		limit = DefaultPlanLimit
	}
	if len(order) != 2 {
		return nil
	}
	a, b := order[0], order[1]
	out := make([]VisitPlan, 0, limit)
	for _, day := range days {
		dk := slotDayKey(day)
		for _, ma := range a.Masters {
			slotsA := trimSlots(perKey[slotKey{Master: ma.MasterUserID, Day: dk, Dur: a.DurationMinutes}])
			for _, sa := range slotsA {
				for _, mb := range b.Masters {
					slotsB := perKey[slotKey{Master: mb.MasterUserID, Day: dk, Dur: b.DurationMinutes}]
					for _, sb := range slotsB {
						if sameMasterOverlap(ma.MasterUserID, mb.MasterUserID, sa, sb) {
							continue
						}
						if sb.StartsAt.Before(sa.EndsAt) {
							continue
						}
						wait := int(sb.StartsAt.Sub(sa.EndsAt) / time.Minute)
						if wait > MaxWaitMinutes {
							continue
						}
						span := int(sb.EndsAt.Sub(sa.StartsAt) / time.Minute)
						same := ma.MasterUserID == mb.MasterUserID
						reason := "contiguous"
						if wait > 0 {
							reason = "nearest_with_wait"
						}
						if same {
							reason = "same_master"
							if wait > 0 {
								reason = "same_master_with_wait"
							}
						}
						out = append(out, VisitPlan{
							Legs: []VisitLeg{
								legFrom(a, ma, sa),
								legFrom(b, mb, sb),
							},
							WaitMinutes:  wait,
							TotalMinutes: span,
							StartsAt:     sa.StartsAt,
							EndsAt:       sb.EndsAt,
							SameMaster:   same,
							Reason:       reason,
						})
					}
				}
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].WaitMinutes != out[j].WaitMinutes {
			return out[i].WaitMinutes < out[j].WaitMinutes
		}
		if out[i].TotalMinutes != out[j].TotalMinutes {
			return out[i].TotalMinutes < out[j].TotalMinutes
		}
		return out[i].StartsAt.Before(out[j].StartsAt)
	})
	out = dedupePlans(out)
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

func trimSlots(slots []Slot) []Slot {
	if len(slots) > maxSlotsPerMasterDay {
		return slots[:maxSlotsPerMasterDay]
	}
	return slots
}

func sameMasterOverlap(aUser, bUser uuid.UUID, a, b Slot) bool {
	if aUser != bUser {
		return false
	}
	return IntervalsOverlap(a.StartsAt, a.EndsAt, b.StartsAt, b.EndsAt)
}

func legFrom(svc PlanService, m PlanCandidate, slot Slot) VisitLeg {
	return VisitLeg{
		ServiceID:         svc.ID,
		ServiceName:       svc.Name,
		MasterID:          m.MasterID,
		MasterUserID:      m.MasterUserID,
		MasterDisplayName: m.MasterDisplayName,
		StartsAt:          slot.StartsAt.UTC(),
		EndsAt:            slot.EndsAt.UTC(),
		DurationMinutes:   svc.DurationMinutes,
		PriceMinor:        svc.PriceMinor,
		Currency:          svc.Currency,
		WorkMode:          slot.WorkMode,
	}
}

func dedupePlans(in []VisitPlan) []VisitPlan {
	seen := map[string]struct{}{}
	out := make([]VisitPlan, 0, len(in))
	for _, p := range in {
		if len(p.Legs) != 2 {
			continue
		}
		key := p.Legs[0].MasterUserID.String() + p.Legs[0].StartsAt.UTC().String() +
			p.Legs[1].MasterUserID.String() + p.Legs[1].StartsAt.UTC().String()
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, p)
	}
	return out
}

func PlanTotalPrice(legs []VisitLeg) int64 {
	var n int64
	for _, l := range legs {
		n += l.PriceMinor
	}
	return n
}
