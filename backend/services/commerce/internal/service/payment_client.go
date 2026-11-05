package service

import (
	"strings"

	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
)

func normalizeClientPaymentMethod(m string) string {
	switch strings.TrimSpace(m) {
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

// resolveClientPaymentStatus sets initial payment_status for a new client order.
// Online card/mock acquiring is not used: new checkouts only accept pay-on-pickup
// methods (see domain.ValidClientPickupPaymentMethod).
func resolveClientPaymentStatus(method string) string {
	return domain.InitialPaymentStatus(normalizeClientPaymentMethod(method))
}
