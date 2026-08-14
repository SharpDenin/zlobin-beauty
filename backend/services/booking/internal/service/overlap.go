package service

import (
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
)

// IntervalsOverlap reports whether half-open intervals [aStart,aEnd) and [bStart,bEnd) overlap.
// Back-to-back slots (aEnd == bStart) do not overlap.
func IntervalsOverlap(aStart, aEnd, bStart, bEnd time.Time) bool {
	return aStart.Before(bEnd) && aEnd.After(bStart)
}

// appointmentBlocksSlot reports whether any existing appointment (except excludeID) overlaps [st,en).
func appointmentBlocksSlot(existing []domain.Appointment, excludeID uuid.UUID, st, en time.Time) bool {
	for _, a := range existing {
		if excludeID != uuid.Nil && a.ID == excludeID {
			continue
		}
		if IntervalsOverlap(st, en, a.StartsAt, a.EndsAt) {
			return true
		}
	}
	return false
}
