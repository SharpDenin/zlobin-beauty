package domain

import (
	"time"

	"github.com/google/uuid"
)

// RepeatCandidate is a completed visit that may be offered as «Как в прошлый раз».
type RepeatCandidate struct {
	ID        uuid.UUID
	ServiceID uuid.UUID
	StartsAt  time.Time
	UpdatedAt time.Time
	HasScheme bool
	Skipped   bool
}

// SelectRepeatSource picks the latest relevant completed visit.
// Prefer the same service when preferred is set, then a stored (non-skipped) scheme, then recency
// of completion (updated_at, falling back to starts_at).
func SelectRepeatSource(items []RepeatCandidate, preferredService uuid.UUID) *RepeatCandidate {
	if len(items) == 0 {
		return nil
	}
	best := 0
	bestScore := repeatScore(items[0], preferredService)
	for i := 1; i < len(items); i++ {
		s := repeatScore(items[i], preferredService)
		if s > bestScore || (s == bestScore && repeatRecency(items[i]).After(repeatRecency(items[best]))) {
			best = i
			bestScore = s
		}
	}
	c := items[best]
	return &c
}

func repeatRecency(c RepeatCandidate) time.Time {
	if !c.UpdatedAt.IsZero() {
		return c.UpdatedAt
	}
	return c.StartsAt
}

func repeatScore(c RepeatCandidate, preferred uuid.UUID) int {
	score := 0
	if preferred != uuid.Nil && c.ServiceID == preferred {
		score += 4
	}
	if c.HasScheme && !c.Skipped {
		score += 2
	} else if c.HasScheme {
		score += 1
	}
	return score
}
