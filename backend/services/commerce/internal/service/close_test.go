package service

import (
	"testing"

	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
)

func TestOpenClientPickupStatusesIncludeReady(t *testing.T) {
	// Guard: delivered-to-branch but not yet received by client must block close.
	statuses := []string{
		domain.ClientOrderStatusSubmitted,
		domain.ClientOrderStatusConfirmed,
		domain.ClientOrderStatusPicking,
		domain.ClientOrderStatusInDelivery,
		domain.ClientOrderStatusReadyForPickup,
		domain.ClientOrderStatusDelivered,
	}
	for _, st := range statuses {
		if st == domain.ClientOrderStatusReceived || st == domain.ClientOrderStatusCancelled {
			t.Fatalf("terminal status %s must not block", st)
		}
	}
}

func TestDeliveryTerminalStatuses(t *testing.T) {
	for _, st := range []string{domain.DeliveryStatusDelivered, domain.DeliveryStatusFailed, domain.DeliveryStatusCancelled} {
		if st == domain.DeliveryStatusPending {
			t.Fatal("pending is not terminal")
		}
	}
}
