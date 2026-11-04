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

func TestConfirmRejectCancelTransitions(t *testing.T) {
	// Master confirm
	if !CanTransition(StatusPendingConfirmation, StatusConfirmed) {
		t.Fatal("master confirm")
	}
	// Master reject = cancel by master
	if !CanTransition(StatusPendingConfirmation, StatusCancelledByMaster) {
		t.Fatal("master reject/cancel from pending")
	}
	if !CanTransition(StatusConfirmed, StatusCancelledByMaster) {
		t.Fatal("master cancel confirmed")
	}
	// Client cancel
	if !CanTransition(StatusPendingConfirmation, StatusCancelledByClient) {
		t.Fatal("client cancel pending")
	}
	if !CanTransition(StatusConfirmed, StatusCancelledByClient) {
		t.Fatal("client cancel confirmed")
	}
	// Terminal: cannot re-confirm after cancel
	if CanTransition(StatusCancelledByMaster, StatusConfirmed) {
		t.Fatal("cancelled must not re-confirm")
	}
}
