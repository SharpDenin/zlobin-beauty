package domain

import "testing"

func TestEvaluateRequirement(t *testing.T) {
	av, sh, st := EvaluateRequirement(30, 40, 0, 0)
	if st != AvailabilityAvailable || av < 39.9 || sh != 0 {
		t.Fatalf("available case av=%v sh=%v st=%s", av, sh, st)
	}
	av, sh, st = EvaluateRequirement(30, 10, 0, 0)
	if st != AvailabilityShortage || sh < 19.9 || sh > 20.1 {
		t.Fatalf("shortage 20 av=%v sh=%v st=%s", av, sh, st)
	}
	av, sh, st = EvaluateRequirement(30, 10, 0, 20)
	if st != AvailabilityIncoming || sh != 0 || av < 9.9 {
		t.Fatalf("covered by incoming av=%v sh=%v st=%s", av, sh, st)
	}
	av, sh, st = EvaluateRequirement(30, 10, 0, 5)
	if st != AvailabilityShortage || sh < 14.9 || sh > 15.1 {
		t.Fatalf("partial incoming shortage 15 av=%v sh=%v st=%s", av, sh, st)
	}
	_, _, st = EvaluateRequirement(30, 0, 0, 0)
	if st != AvailabilityUnavailable {
		t.Fatalf("unavailable st=%s", st)
	}
	av, _, st = EvaluateRequirement(30, 50, 20, 0)
	if st != AvailabilityAvailable || av < 29.9 {
		t.Fatalf("reserved reduces available av=%v st=%s", av, st)
	}
}

func TestCanRepeatAndWorst(t *testing.T) {
	if !CanRepeatFromStatuses([]string{AvailabilityAvailable, AvailabilityAvailable}) {
		t.Fatal("all available should allow repeat")
	}
	if CanRepeatFromStatuses([]string{AvailabilityAvailable, AvailabilityIncoming}) {
		t.Fatal("incoming is not current stock")
	}
	if WorstAvailability([]string{AvailabilityAvailable, AvailabilityShortage, AvailabilityIncoming}) != AvailabilityShortage {
		t.Fatal("worst should be shortage")
	}
}
