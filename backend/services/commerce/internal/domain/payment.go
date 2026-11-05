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

// ValidClientPickupPaymentMethod reports whether m is allowed for new client-shop
// checkout (pay on pickup only). Source of truth for client shop; card/invoice
// and other online methods are rejected for new orders. Legacy orders may still
// store historical methods and are handled outside of create-path validation.
func ValidClientPickupPaymentMethod(m string) bool {
	switch strings.TrimSpace(m) {
	case PaymentMethodCash, PaymentMethodBankTransfer:
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

// ClientOrderReturnCreditMinor returns the debt_ledger amount for a full return.
// Ledger convention (existing writers): delivery_charge is positive (increases
// client debt), payment is negative (reduces debt). return_credit follows the
// same credit direction as payment: negative amount_minor equal to the
// delivered merchandise value.
func ClientOrderReturnCreditMinor(items []ClientOrderItem) int64 {
	var total int64
	for _, it := range items {
		qty := it.QtyDelivered
		if qty <= 1e-9 {
			qty = it.Qty
		}
		total += int64(qty*float64(it.PriceMinor) + 0.5)
	}
	if total == 0 {
		return 0
	}
	return -total
}
