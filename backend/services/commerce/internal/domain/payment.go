package domain

import "strings"

// ValidPaymentMethod reports whether m is an allowed supplier-order payment method.
func ValidPaymentMethod(m string) bool {
	switch strings.TrimSpace(m) {
	case PaymentMethodCash, PaymentMethodBankTransfer, PaymentMethodCard, PaymentMethodInvoice:
		return true
	default:
		return false
	}
}

// InitialPaymentStatus chooses pending for cash, awaiting_payment otherwise.
func InitialPaymentStatus(method string) string {
	if strings.TrimSpace(method) == PaymentMethodCash {
		return PaymentStatusPending
	}
	return PaymentStatusAwaitingPayment
}

// NormalizePaymentMethod returns a trimmed method or cash when empty.
func NormalizePaymentMethod(m string) string {
	m = strings.TrimSpace(m)
	if m == "" {
		return PaymentMethodCash
	}
	return m
}
