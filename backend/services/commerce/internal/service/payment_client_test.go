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
}

func TestMockCardPaymentProvider(t *testing.T) {
	p := MockCardPaymentProvider{}
	status, err := p.Initiate(t.Context(), domain.ClientOrder{})
	if err != nil {
		t.Fatal(err)
	}
	if status != domain.PaymentStatusAuthorized {
		t.Fatalf("want authorized got %q", status)
	}
}
