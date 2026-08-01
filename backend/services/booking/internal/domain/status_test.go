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
