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
