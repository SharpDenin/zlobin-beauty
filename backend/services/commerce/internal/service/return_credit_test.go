package service

import (
	"testing"

	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
)

// Documents the confirmed ledger sign convention used by ReturnClientOrder:
// delivery_charge > 0 increases debt; payment < 0 reduces debt; return_credit
// must reduce debt the same way as payment (negative amount_minor).
func TestReturnCreditSignMatchesPaymentConvention(t *testing.T) {
	items := []domain.ClientOrderItem{
		{Qty: 1, QtyDelivered: 1, PriceMinor: 10_00},
	}
	credit := domain.ClientOrderReturnCreditMinor(items)
	if credit >= 0 {
		t.Fatalf("return_credit must be negative to reduce SUM(amount_minor), got %d", credit)
	}
	// Mirrors CompleteRepDelivery payment entry sign.
	payment := -int64(10_00)
	if credit != payment {
		t.Fatalf("full return credit %d must equal negated paid amount %d", credit, payment)
	}
}
