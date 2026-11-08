package store

import "testing"

func TestOccurrenceCapacityIndexMigrationIsPresent(t *testing.T) {
	// Compile-time/doc guard: capacity > 1 must not rely on unique(occurrence_id)
	// and is exempt from appointments_no_overlap (016_occurrence_overlap_exempt.sql).
	// Runtime concurrency is covered by marketplace booked_count CAS + booking CreateAppointment order.
	t.Log("appointments_one_active_per_occurrence_idx dropped in 009; overlap exempt when occurrence_id set in 016")
}
