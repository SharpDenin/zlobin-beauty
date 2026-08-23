package service

import (
	"context"

	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
)

// ClientPaymentProvider abstracts card/acquiring for client shop checkout.
type ClientPaymentProvider interface {
	Initiate(ctx context.Context, order domain.ClientOrder) (status string, err error)
}

// MockCardPaymentProvider simulates online card authorization in dev/demo.
type MockCardPaymentProvider struct{}

func (MockCardPaymentProvider) Initiate(_ context.Context, _ domain.ClientOrder) (string, error) {
	return domain.PaymentStatusAuthorized, nil
}

func normalizeClientPaymentMethod(m string) string {
	switch m {
	case "cash_on_delivery", "cash":
		return domain.PaymentMethodCash
	case "bank_transfer":
		return domain.PaymentMethodBankTransfer
	case "card", "card_online":
		return domain.PaymentMethodCard
	default:
		return domain.NormalizePaymentMethod(m)
	}
}

func clientPaymentProvider(method string) ClientPaymentProvider {
	if normalizeClientPaymentMethod(method) == domain.PaymentMethodCard {
		return MockCardPaymentProvider{}
	}
	return nil
}

func resolveClientPaymentStatus(method string, provider ClientPaymentProvider, ctx context.Context, order domain.ClientOrder) (string, error) {
	method = normalizeClientPaymentMethod(method)
	if provider != nil {
		return provider.Initiate(ctx, order)
	}
	return domain.InitialPaymentStatus(method), nil
}
