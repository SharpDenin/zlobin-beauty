package service

import "testing"

func TestCanRepeatStatuses(t *testing.T) {
	if !canRepeatStatuses(nil) || !canRepeatStatuses([]string{"available"}) {
		t.Fatal("empty or all available should allow repeat")
	}
	if canRepeatStatuses([]string{"available", "incoming"}) {
		t.Fatal("incoming is not current stock")
	}
	if canRepeatStatuses([]string{"shortage"}) || canRepeatStatuses([]string{"unavailable"}) {
		t.Fatal("shortage/unavailable cannot repeat from stock")
	}
}

func TestWorstAvailability(t *testing.T) {
	if got := worstAvailability(nil); got != "available" {
		t.Fatalf("empty %s", got)
	}
	if got := worstAvailability([]string{"available", "incoming", "shortage"}); got != "shortage" {
		t.Fatalf("got %s", got)
	}
	if got := worstAvailability([]string{"available", "unavailable"}); got != "unavailable" {
		t.Fatalf("got %s", got)
	}
}
