package domain

import "testing"

func TestCanTransition(t *testing.T) {
	if !CanTransition(StatusPendingConfirmation, StatusConfirmed) {
		t.Fatal("expected pending -> confirmed")
	}
	if CanTransition(StatusCompleted, StatusConfirmed) {
		t.Fatal("completed is terminal")
	}
	if err := Transition(StatusConfirmed, StatusInProgress); err != nil {
		t.Fatal(err)
	}
	if err := Transition(StatusConfirmed, StatusCompleted); err == nil {
		t.Fatal("expected error skipping in_progress")
	}
}

func TestCanReschedule(t *testing.T) {
	if !CanReschedule(StatusConfirmed, BookingModeFlexible) {
		t.Fatal("confirmed flexible must reschedule")
	}
	if !CanReschedule(StatusPendingConfirmation, "") {
		t.Fatal("pending confirmation must reschedule")
	}
	if CanReschedule(StatusConfirmed, BookingModeFixedWindow) {
		t.Fatal("fixed window must not reschedule")
	}
	if CanReschedule(StatusCompleted, BookingModeFlexible) {
		t.Fatal("completed must not reschedule")
	}
	if CanReschedule(StatusCancelledByClient, BookingModeFlexible) {
		t.Fatal("cancelled must not reschedule")
	}
	if CanReschedule(StatusInProgress, BookingModeFlexible) {
		t.Fatal("in progress must not reschedule")
	}
}
