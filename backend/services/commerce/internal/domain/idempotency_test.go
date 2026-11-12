package domain

import (
	"testing"

	"github.com/google/uuid"
)

func TestScopeStockIdempotencyKey(t *testing.T) {
	actor := uuid.MustParse("018f0000-0000-7000-8000-000000000001")
	locA := uuid.MustParse("018f0000-0000-7000-8000-000000000002")
	locB := uuid.MustParse("018f0000-0000-7000-8000-000000000003")
	other := uuid.MustParse("018f0000-0000-7000-8000-000000000004")

	a := ScopeStockIdempotencyKey(actor, locA, "client-1")
	b := ScopeStockIdempotencyKey(actor, locB, "client-1")
	c := ScopeStockIdempotencyKey(other, locA, "client-1")
	if a == "" || a == b || a == c {
		t.Fatalf("expected isolation by actor/location, got a=%q b=%q c=%q", a, b, c)
	}
	if ScopeStockIdempotencyKey(actor, locA, "  ") != "" {
		t.Fatal("blank client key must be empty")
	}
	if ScopeStockIdempotencyKey(uuid.Nil, locA, "x") != "" {
		t.Fatal("nil actor must be empty")
	}
}

func TestStockMovementMatchesIdempotentReplay(t *testing.T) {
	loc := uuid.MustParse("018f0000-0000-7000-8000-000000000011")
	prod := uuid.MustParse("018f0000-0000-7000-8000-000000000012")
	m := &StockMovement{
		LocationID: loc, ProductID: prod, Kind: MovementAdjust, Qty: 5, Reason: "ручной приход",
	}
	if !StockMovementMatchesIdempotentReplay(m, loc, prod, MovementAdjust, 5, "ручной приход") {
		t.Fatal("identical payload should match")
	}
	if StockMovementMatchesIdempotentReplay(m, loc, prod, MovementAdjust, 6, "ручной приход") {
		t.Fatal("qty mismatch must not match")
	}
	if StockMovementMatchesIdempotentReplay(m, loc, prod, MovementAdjust, 5, "другое") {
		t.Fatal("reason mismatch must not match")
	}
	if StockMovementMatchesIdempotentReplay(m, loc, prod, MovementReceipt, 5, "ручной приход") {
		t.Fatal("kind mismatch must not match")
	}
}
