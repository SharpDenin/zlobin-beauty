package service

import (
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/store"
)

// freeSlotWindow is a working interval in minutes from local midnight.
type freeSlotWindow struct{ start, end int }

// computeFreeSlots builds candidate slots for one local calendar day.
// step is always 30 minutes; starts that do not fully fit in a window are omitted.
// workModes: when empty, every free candidate is allowed with empty mode;
// when non-empty, the candidate must be fully covered by one interval.
func computeFreeSlots(
	localDay time.Time,
	windows []freeSlotWindow,
	durationMinutes int,
	now time.Time,
	existing []domain.Appointment,
	excludeAppointmentID uuid.UUID,
	blocks []store.PlannerBlock,
	workModes []domain.WorkModeInterval,
) []Slot {
	step := 30
	nowUTC := now.UTC()
	var slots []Slot
	for _, w := range windows {
		for start := w.start; start+durationMinutes <= w.end; start += step {
			st := localDay.Add(time.Duration(start) * time.Minute).UTC()
			en := st.Add(time.Duration(durationMinutes) * time.Minute)
			if !st.After(nowUTC) {
				continue
			}
			if appointmentBlocksSlot(existing, excludeAppointmentID, st, en) {
				continue
			}
			if plannerBlocksSlot(blocks, uuid.Nil, st, en) {
				continue
			}
			mode := ""
			if len(workModes) > 0 {
				cov := coveringWorkMode(workModes, st, en)
				if cov == nil {
					continue
				}
				mode = cov.Mode
			}
			slots = append(slots, Slot{StartsAt: st, EndsAt: en, WorkMode: mode})
		}
	}
	if slots == nil {
		slots = []Slot{}
	}
	return slots
}
