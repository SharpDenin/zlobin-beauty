package domain

import "math"

// LineTotalMinor computes qty * price_minor with half-up rounding into int64 minor units.
// Fractional quantities are allowed; prefer whole quantities at the API layer when possible.
func LineTotalMinor(qty float64, priceMinor int64) int64 {
	if qty <= 0 || priceMinor < 0 {
		return 0
	}
	return int64(math.Round(qty * float64(priceMinor)))
}

// OrderTotalMinor returns subtotal + delivery cost (both must be >= 0).
func OrderTotalMinor(subtotalMinor, deliveryCostMinor int64) int64 {
	if subtotalMinor < 0 {
		subtotalMinor = 0
	}
	if deliveryCostMinor < 0 {
		deliveryCostMinor = 0
	}
	return subtotalMinor + deliveryCostMinor
}
