package store

import (
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

// stockEpsilon absorbs float64 noise when comparing NUMERIC(12,3) quantities.
const stockEpsilon = 1e-9

// StockState is the mutable part of a stock_balances row.
type StockState struct {
	OnHand   float64
	Reserved float64
}

// movementOutcome is the result of applying a movement to a StockState.
type movementOutcome struct {
	State  StockState
	Qty    float64 // quantity to record (unreserve/release is clamped to what is reserved)
	Before float64 // qty_before for the movement row
	After  float64 // qty_after for the movement row
}

// computeMovement is the single business rule for stock movements. It never
// touches the database, so every "beyond available" case can be tested directly.
//
// For on-hand kinds (receipt, return, consumption, write_off, adjust) m.Qty is
// the signed delta on qty_on_hand. For reserve/unreserve/release/shipment m.Qty
// is the positive amount. Any movement that would leave on-hand negative, dip
// into reserved stock, or ship more than reserved fails with the typed
// insufficient_stock error (HTTP 409).
func computeMovement(m domain.StockMovement, cur StockState) (movementOutcome, error) {
	onHand, reserved := cur.OnHand, cur.Reserved
	out := movementOutcome{Qty: m.Qty}
	short := func() (movementOutcome, error) {
		return movementOutcome{}, InsufficientStockAt(m.ProductID, m.LocationID)
	}

	switch m.Kind {
	case domain.MovementReserve:
		if m.Qty <= 0 {
			return movementOutcome{}, apperr.Validation("qty must be positive for reserve")
		}
		if onHand-reserved < m.Qty-stockEpsilon {
			return short()
		}
		out.Before = reserved
		reserved += m.Qty
		out.After = reserved
	case domain.MovementUnreserve, domain.MovementRelease:
		if m.Qty <= 0 {
			return movementOutcome{}, apperr.Validation("qty must be positive for unreserve")
		}
		out.Before = reserved
		amount := m.Qty
		if amount > reserved {
			amount = reserved
		}
		reserved -= amount
		out.After = reserved
		out.Qty = amount
	case domain.MovementShipment:
		if m.Qty <= 0 {
			return movementOutcome{}, apperr.Validation("qty must be positive for shipment")
		}
		if reserved+stockEpsilon < m.Qty || onHand+stockEpsilon < m.Qty {
			return short()
		}
		out.Before = onHand
		onHand -= m.Qty
		reserved -= m.Qty
		out.After = onHand
	case domain.MovementReceipt, domain.MovementReturn:
		out.Before = onHand
		onHand += m.Qty
		if onHand < 0 {
			return short()
		}
		out.After = onHand
	case domain.MovementConsumption, domain.MovementWriteOff, domain.MovementAdjust:
		out.Before = onHand
		onHand += m.Qty
		if onHand < 0 || onHand-reserved < -stockEpsilon {
			return short()
		}
		out.After = onHand
	case domain.MovementDamage, domain.MovementRejection:
		if m.Qty <= 0 {
			return movementOutcome{}, apperr.Validation("qty must be positive for " + m.Kind)
		}
		out.Before, out.After = onHand, onHand
	default:
		return movementOutcome{}, apperr.Validation("unknown movement kind")
	}

	out.State = StockState{OnHand: onHand, Reserved: reserved}
	return out, nil
}
