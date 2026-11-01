package domain

import (
	"testing"

	"github.com/google/uuid"
)

func mustParseUUID(s string) uuid.UUID {
	id, err := uuid.Parse(s)
	if err != nil {
		panic(err)
	}
	return id
}

func TestValidPaymentMethod(t *testing.T) {
	for _, m := range []string{PaymentMethodCash, PaymentMethodBankTransfer, PaymentMethodCard, PaymentMethodInvoice} {
		if !ValidPaymentMethod(m) {
			t.Fatalf("expected valid: %s", m)
		}
	}
	if ValidPaymentMethod("crypto") {
		t.Fatal("crypto invalid")
	}
	if ValidPaymentMethod("") {
		t.Fatal("empty invalid")
	}
}

func TestValidClientPickupPaymentMethod(t *testing.T) {
	if !ValidClientPickupPaymentMethod(PaymentMethodCash) {
		t.Fatal("cash must be allowed for pickup checkout")
	}
	if !ValidClientPickupPaymentMethod(PaymentMethodBankTransfer) {
		t.Fatal("bank_transfer is pay-on-pickup and must be allowed")
	}
	for _, m := range []string{PaymentMethodCard, PaymentMethodInvoice, "crypto", ""} {
		if ValidClientPickupPaymentMethod(m) {
			t.Fatalf("expected rejected for new client checkout: %q", m)
		}
	}
}

func TestClientOrderReturnCreditMinor(t *testing.T) {
	items := []ClientOrderItem{
		{Qty: 2, QtyDelivered: 2, PriceMinor: 1500},
		{Qty: 1, QtyDelivered: 1, PriceMinor: 500},
	}
	if got := ClientOrderReturnCreditMinor(items); got != -3500 {
		t.Fatalf("want -3500 (credit reduces debt), got %d", got)
	}
	// Falls back to ordered qty when qty_delivered is unset.
	if got := ClientOrderReturnCreditMinor([]ClientOrderItem{{Qty: 3, PriceMinor: 100}}); got != -300 {
		t.Fatalf("want -300, got %d", got)
	}
	if got := ClientOrderReturnCreditMinor(nil); got != 0 {
		t.Fatalf("empty => 0, got %d", got)
	}
}

func TestInitialPaymentStatus(t *testing.T) {
	if got := InitialPaymentStatus(PaymentMethodCash); got != PaymentStatusPending {
		t.Fatalf("cash => pending, got %s", got)
	}
	if got := InitialPaymentStatus(PaymentMethodBankTransfer); got != PaymentStatusAwaitingPayment {
		t.Fatalf("bank_transfer => awaiting_payment, got %s", got)
	}
	if got := InitialPaymentStatus(PaymentMethodCard); got != PaymentStatusAwaitingPayment {
		t.Fatalf("card => awaiting_payment, got %s", got)
	}
}

func TestNormalizePaymentMethod(t *testing.T) {
	if got := NormalizePaymentMethod(""); got != PaymentMethodCash {
		t.Fatalf("empty defaults to cash, got %s", got)
	}
	if got := NormalizePaymentMethod("  invoice "); got != PaymentMethodInvoice {
		t.Fatalf("trim, got %s", got)
	}
}

func TestLineTotalMinor(t *testing.T) {
	if got := LineTotalMinor(2, 1500); got != 3000 {
		t.Fatalf("2*1500=3000, got %d", got)
	}
	if got := LineTotalMinor(1.5, 100); got != 150 {
		t.Fatalf("1.5*100=150, got %d", got)
	}
	// half-up: 0.5 * 101 = 50.5 -> 51
	if got := LineTotalMinor(0.5, 101); got != 51 {
		t.Fatalf("half-up 0.5*101 => 51, got %d", got)
	}
	if got := LineTotalMinor(0, 100); got != 0 {
		t.Fatalf("zero qty")
	}
}

func TestOrderTotalMinor(t *testing.T) {
	if got := OrderTotalMinor(1000, 250); got != 1250 {
		t.Fatalf("got %d", got)
	}
}
