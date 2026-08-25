package domain

import (
	"time"

	"github.com/google/uuid"
)

const (
	AvailabilityAvailable   = "available"
	AvailabilityIncoming    = "incoming"
	AvailabilityShortage    = "shortage"
	AvailabilityUnavailable = "unavailable"
)

// RequirementCheck is one material line for a repeat preview.
type RequirementCheck struct {
	ProductID    uuid.UUID
	Name         string
	Brand        string
	Unit         string
	RequiredQty  float64
	AvailableQty float64
	IncomingQty  float64
	ShortageQty  float64
	Status       string
	ExpectedAt   *time.Time
}

// EvaluateRequirement compares current master available stock (on_hand − reserved)
// against required qty and expected incoming. Incoming is never treated as stock.
func EvaluateRequirement(required, onHand, reserved, incoming float64) (available, shortage float64, status string) {
	available = onHand - reserved
	if available < 0 {
		available = 0
	}
	if incoming < 0 {
		incoming = 0
	}
	if required < 1e-9 {
		return available, 0, AvailabilityAvailable
	}
	if available+1e-9 >= required {
		return available, 0, AvailabilityAvailable
	}
	gap := required - available
	covered := available + incoming
	if covered+1e-9 >= required {
		return available, 0, AvailabilityIncoming
	}
	shortage = required - covered
	if available+incoming <= 1e-9 {
		return available, shortage, AvailabilityUnavailable
	}
	_ = gap
	return available, shortage, AvailabilityShortage
}

func WorstAvailability(statuses []string) string {
	rank := map[string]int{
		AvailabilityAvailable:   0,
		AvailabilityIncoming:    1,
		AvailabilityShortage:    2,
		AvailabilityUnavailable: 3,
	}
	worst := AvailabilityAvailable
	bestRank := 0
	for _, st := range statuses {
		if rank[st] > bestRank {
			bestRank = rank[st]
			worst = st
		}
	}
	return worst
}

func CanRepeatFromStatuses(statuses []string) bool {
	if len(statuses) == 0 {
		return true
	}
	for _, st := range statuses {
		if st != AvailabilityAvailable {
			return false
		}
	}
	return true
}
