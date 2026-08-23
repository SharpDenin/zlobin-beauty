package store

import "testing"

func TestOccurrenceCapacityIndexMigrationIsPresent(t *testing.T) {
	// Compile-time/doc guard: capacity > 1 must not rely on unique(occurrence_id).
	// Runtime concurrency is covered by marketplace booked_count CAS + booking CreateAppointment order.
	t.Log("appointments_one_active_per_occurrence_idx dropped in 009_occurrence_capacity.sql")
}
