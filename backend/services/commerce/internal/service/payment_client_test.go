package service

import (
	"testing"

	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
)

func TestNormalizeClientPaymentMethod(t *testing.T) {
	if got := normalizeClientPaymentMethod("cash_on_delivery"); got != domain.PaymentMethodCash {
		t.Fatalf("cash_on_delivery want cash got %q", got)
	}
	if got := normalizeClientPaymentMethod("card"); got != domain.PaymentMethodCard {
		t.Fatalf("card want card got %q", got)
	}
	if got := normalizeClientPaymentMethod("bank_transfer"); got != domain.PaymentMethodBankTransfer {
		t.Fatalf("bank_transfer want bank_transfer got %q", got)
	}
}

func TestResolveClientPaymentStatus(t *testing.T) {
	if got := resolveClientPaymentStatus("cash"); got != domain.PaymentStatusPending {
		t.Fatalf("cash => pending, got %q", got)
	}
	if got := resolveClientPaymentStatus("bank_transfer"); got != domain.PaymentStatusAwaitingPayment {
		t.Fatalf("bank_transfer => awaiting_payment, got %q", got)
	}
}
