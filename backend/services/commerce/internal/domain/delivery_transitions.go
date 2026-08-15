package domain

import (
	"strings"

	"github.com/google/uuid"
)

// orderSupplierTransitions defines allowed commercial + legacy order status changes.
// Legacy in_transit/delivered remain for old clients; new flow prefers delivery status.
var orderSupplierTransitions = map[string]map[string]bool{
	OrderStatusNew: {
		OrderStatusConfirmed: true,
		OrderStatusCancelled: true,
	},
	OrderStatusSubmitted: {
		OrderStatusConfirmed: true,
		OrderStatusCancelled: true,
	},
	OrderStatusConfirmed: {
		OrderStatusProcessing: true,
		OrderStatusPicking:    true,
		OrderStatusCancelled:  true,
	},
	OrderStatusProcessing: {
		OrderStatusPicking:          true,
		OrderStatusReadyForDispatch: true,
		OrderStatusCancelled:        true,
	},
	OrderStatusPicking: {
		OrderStatusReadyForDispatch: true,
		OrderStatusInTransit:        true, // legacy
		OrderStatusCancelled:        true,
	},
	OrderStatusReadyForDispatch: {
		OrderStatusInTransit: true, // legacy
		OrderStatusCompleted: true,
		OrderStatusCancelled: true,
	},
	OrderStatusInTransit: {
		OrderStatusDelivered: true, // legacy
		OrderStatusCompleted: true,
	},
}

// deliveryTransitions defines allowed delivery status changes.
var deliveryTransitions = map[string]map[string]bool{
	DeliveryStatusPending: {
		DeliveryStatusScheduled: true,
		DeliveryStatusPreparing: true,
		DeliveryStatusCancelled: true,
		DeliveryStatusFailed:    true,
	},
	DeliveryStatusScheduled: {
		DeliveryStatusPreparing: true,
		DeliveryStatusCancelled: true,
		DeliveryStatusFailed:    true,
	},
	DeliveryStatusPreparing: {
		DeliveryStatusInTransit: true,
		DeliveryStatusCancelled: true,
		DeliveryStatusFailed:    true,
	},
	DeliveryStatusInTransit: {
		DeliveryStatusArrived:   true,
		DeliveryStatusDelivered: true,
		DeliveryStatusFailed:    true,
	},
	DeliveryStatusArrived: {
		DeliveryStatusDelivered: true,
		DeliveryStatusFailed:    true,
	},
}

// CanTransitionOrder reports whether from→to is allowed for supplier orders.
func CanTransitionOrder(from, to string) bool {
	allowed, ok := orderSupplierTransitions[from]
	return ok && allowed[to]
}

// CanTransitionDelivery reports whether from→to is allowed for order deliveries.
func CanTransitionDelivery(from, to string) bool {
	allowed, ok := deliveryTransitions[from]
	return ok && allowed[to]
}

// OrderAllowsInTransitDelivery is true when the commercial order is far enough
// along for physical dispatch (confirmed / processing / picking / ready / legacy in_transit).
func OrderAllowsInTransitDelivery(orderStatus string) bool {
	switch orderStatus {
	case OrderStatusConfirmed, OrderStatusProcessing, OrderStatusPicking,
		OrderStatusReadyForDispatch, OrderStatusInTransit:
		return true
	default:
		return false
	}
}

// CanMarkDeliveryDelivered requires prior in_transit or arrived (no skip).
func CanMarkDeliveryDelivered(from string) bool {
	return from == DeliveryStatusInTransit || from == DeliveryStatusArrived
}

// DeliveryAllowsDestinationChange is true only while the delivery has not been scheduled/prepared.
func DeliveryAllowsDestinationChange(status string) bool {
	return status == DeliveryStatusPending
}

// ShouldPrepareDeliveryOnOrderTransition is true for picking / ready_for_dispatch.
func ShouldPrepareDeliveryOnOrderTransition(toStatus string) bool {
	return toStatus == OrderStatusPicking || toStatus == OrderStatusReadyForDispatch
}

// ProductEligibleForOrder checks published + for_sale + supplier ownership.
func ProductEligibleForOrder(published, forSale bool, productOrgID, supplierOrgID uuid.UUID) bool {
	return published && forSale && productOrgID == supplierOrgID
}

func ProductVisibleTo(audience string, professional bool) bool {
	if strings.EqualFold(audience, "professional_only") {
		return professional
	}
	return true
}
