package domain

import "testing"

func TestCanTransitionOrderLegacyAndNew(t *testing.T) {
	if !CanTransitionOrder(OrderStatusNew, OrderStatusConfirmed) {
		t.Fatal("new -> confirmed")
	}
	if !CanTransitionOrder(OrderStatusConfirmed, OrderStatusProcessing) {
		t.Fatal("confirmed -> processing")
	}
	if !CanTransitionOrder(OrderStatusConfirmed, OrderStatusPicking) {
		t.Fatal("confirmed -> picking (legacy)")
	}
	if !CanTransitionOrder(OrderStatusProcessing, OrderStatusReadyForDispatch) {
		t.Fatal("processing -> ready_for_dispatch")
	}
	if !CanTransitionOrder(OrderStatusPicking, OrderStatusInTransit) {
		t.Fatal("picking -> in_transit (legacy)")
	}
	if !CanTransitionOrder(OrderStatusReadyForDispatch, OrderStatusCompleted) {
		t.Fatal("ready_for_dispatch -> completed")
	}
	if CanTransitionOrder(OrderStatusNew, OrderStatusCompleted) {
		t.Fatal("must not skip to completed")
	}
}

func TestCanTransitionDelivery(t *testing.T) {
	if !CanTransitionDelivery(DeliveryStatusPending, DeliveryStatusScheduled) {
		t.Fatal("pending -> scheduled")
	}
	if !CanTransitionDelivery(DeliveryStatusPreparing, DeliveryStatusInTransit) {
		t.Fatal("preparing -> in_transit")
	}
	if !CanMarkDeliveryDelivered(DeliveryStatusInTransit) {
		t.Fatal("in_transit can deliver")
	}
	if !CanMarkDeliveryDelivered(DeliveryStatusArrived) {
		t.Fatal("arrived can deliver")
	}
	if CanMarkDeliveryDelivered(DeliveryStatusPreparing) {
		t.Fatal("cannot skip prepare -> delivered")
	}
	if CanTransitionDelivery(DeliveryStatusPending, DeliveryStatusDelivered) {
		t.Fatal("cannot pending -> delivered")
	}
	if DeliveryAllowsDestinationChange(DeliveryStatusScheduled) {
		t.Fatal("destination locked after scheduled")
	}
	if !DeliveryAllowsDestinationChange(DeliveryStatusPending) {
		t.Fatal("pending may change destination")
	}
}

func TestOrderAllowsInTransitDelivery(t *testing.T) {
	if !OrderAllowsInTransitDelivery(OrderStatusReadyForDispatch) {
		t.Fatal("ready_for_dispatch allows in_transit delivery")
	}
	if OrderAllowsInTransitDelivery(OrderStatusNew) {
		t.Fatal("new must not allow in_transit delivery")
	}
	if OrderAllowsInTransitDelivery(OrderStatusCancelled) {
		t.Fatal("cancelled must not allow in_transit")
	}
}

func TestShouldPrepareDeliveryOnOrderTransition(t *testing.T) {
	if !ShouldPrepareDeliveryOnOrderTransition(OrderStatusPicking) {
		t.Fatal("picking prepares delivery")
	}
	if !ShouldPrepareDeliveryOnOrderTransition(OrderStatusReadyForDispatch) {
		t.Fatal("ready_for_dispatch prepares delivery")
	}
	if ShouldPrepareDeliveryOnOrderTransition(OrderStatusConfirmed) {
		t.Fatal("confirmed does not auto-prepare")
	}
}

func TestProductEligibleForOrder(t *testing.T) {
	supplier := mustParseUUID("11111111-1111-1111-1111-111111111111")
	other := mustParseUUID("22222222-2222-2222-2222-222222222222")
	if !ProductEligibleForOrder(true, true, supplier, supplier) {
		t.Fatal("published for_sale matching supplier")
	}
	if ProductEligibleForOrder(false, true, supplier, supplier) {
		t.Fatal("unpublished rejected")
	}
	if ProductEligibleForOrder(true, false, supplier, supplier) {
		t.Fatal("not for_sale rejected")
	}
	if ProductEligibleForOrder(true, true, other, supplier) {
		t.Fatal("wrong supplier rejected")
	}
}
