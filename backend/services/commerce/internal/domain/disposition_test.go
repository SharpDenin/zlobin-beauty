package domain

import (
	"testing"

	"github.com/google/uuid"
)

func TestLineReceivableAndAcceptanceState(t *testing.T) {
	if got := LineReceivable(10, 0, 6, 0, 0); got < 3.9 || got > 4.1 {
		t.Fatalf("legacy remaining after partial accept=%v want 4", got)
	}
	if got := LineReceivable(100, 90, 80, 5, 5); got < 9.9 || got > 10.1 {
		t.Fatalf("leftover delivered 0 falls back to remaining vs ordered=%v want 10", got)
	}
	if got := DispositionUndelivered(100, 90); got < 9.9 || got > 10.1 {
		t.Fatalf("undelivered=%v want 10", got)
	}
	pending := []SupplierOrderItem{{QtyOrdered: 10}}
	if got := OrderAcceptanceState(pending); got != AcceptancePending {
		t.Fatalf("state=%s", got)
	}
	partial := []SupplierOrderItem{{QtyOrdered: 10, QtyAccepted: 6}}
	if got := OrderAcceptanceState(partial); got != AcceptanceInProgress {
		t.Fatalf("state=%s", got)
	}
	done := []SupplierOrderItem{{QtyOrdered: 10, QtyAccepted: 8, QtyDamaged: 1, QtyRejected: 1}}
	if got := OrderAcceptanceState(done); got != AcceptanceCompleted {
		t.Fatalf("state=%s", got)
	}
	key := AcceptMovementIdempotencyKey("abc", MovementReceipt, uuid.MustParse("00000000-0000-0000-0000-000000000001"))
	if key == "" || key == "abc" {
		t.Fatalf("expected namespaced idempotency key, got %q", key)
	}
}

func TestDispositionRemaining(t *testing.T) {
	if got := DispositionRemaining(100, 80, 10, 10); got != 0 {
		t.Fatalf("full disposition remaining=%v", got)
	}
	if got := DispositionRemaining(10, 6, 0, 0); got < 3.9 || got > 4.1 {
		t.Fatalf("partial remaining=%v want 4", got)
	}
	if got := DispositionRemaining(5, 5, 0, 0); got != 0 {
		t.Fatalf("already accepted remaining=%v", got)
	}
	if got := DispositionRemaining(1, 2, 0, 0); got != 0 {
		t.Fatalf("over-accepted remaining=%v", got)
	}
}
