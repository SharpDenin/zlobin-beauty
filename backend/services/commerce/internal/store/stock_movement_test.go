package store

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"unicode"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

var (
	testProductID  = uuid.MustParse("018f0000-0000-7000-8000-0000000000a1")
	testLocationID = uuid.MustParse("018f0000-0000-7000-8000-0000000000a2")
)

func movement(kind string, qty float64) domain.StockMovement {
	return domain.StockMovement{ID: uuid.New(), LocationID: testLocationID, ProductID: testProductID, Kind: kind, Qty: qty}
}

// The supplier warehouse / master inventory rules: nothing may leave a location
// beyond what is available (on hand minus reserved) and shipments are bounded by
// what was reserved. There is no "transfer" movement kind in the commerce domain.
func TestComputeMovementBeyondAvailableIsInsufficientStock(t *testing.T) {
	cases := []struct {
		name string
		m    domain.StockMovement
		cur  StockState
	}{
		{"write_off more than on hand", movement(domain.MovementWriteOff, -6), StockState{OnHand: 5}},
		{"write_off into reserved stock", movement(domain.MovementWriteOff, -5), StockState{OnHand: 10, Reserved: 8}},
		{"write_off from empty location", movement(domain.MovementWriteOff, -1), StockState{}},
		{"consumption more than on hand", movement(domain.MovementConsumption, -2.5), StockState{OnHand: 2}},
		{"consumption into reserved stock", movement(domain.MovementConsumption, -3), StockState{OnHand: 4, Reserved: 2}},
		{"shipment more than reserved", movement(domain.MovementShipment, 3), StockState{OnHand: 10, Reserved: 2}},
		{"shipment more than on hand", movement(domain.MovementShipment, 3), StockState{OnHand: 2, Reserved: 5}},
		{"shipment with nothing reserved", movement(domain.MovementShipment, 1), StockState{OnHand: 10}},
		{"reserve more than available", movement(domain.MovementReserve, 3), StockState{OnHand: 10, Reserved: 8}},
		{"reserve from empty location", movement(domain.MovementReserve, 1), StockState{}},
		{"negative adjustment below zero", movement(domain.MovementAdjust, -11), StockState{OnHand: 10}},
		{"negative adjustment below reserved", movement(domain.MovementAdjust, -4), StockState{OnHand: 10, Reserved: 8}},
		{"negative receipt below zero", movement(domain.MovementReceipt, -1), StockState{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := computeMovement(tc.m, tc.cur)
			ae, ok := apperr.As(err)
			if !ok {
				t.Fatalf("want AppError, got %#v", err)
			}
			if ae.HTTPStatus != http.StatusConflict || ae.Code != apperr.CodeInsufficientStock {
				t.Fatalf("status=%d code=%s", ae.HTTPStatus, ae.Code)
			}
			if ae.Details["product_id"] != testProductID.String() || ae.Details["location_id"] != testLocationID.String() {
				t.Fatalf("details %+v", ae.Details)
			}
		})
	}
}

// Same rule end to end at the wire: what the supplier's browser receives.
func TestInsufficientStockWireFormat(t *testing.T) {
	cases := map[string]struct {
		m   domain.StockMovement
		cur StockState
	}{
		"write_off": {movement(domain.MovementWriteOff, -6), StockState{OnHand: 5}},
		"shipment":  {movement(domain.MovementShipment, 3), StockState{OnHand: 10, Reserved: 2}},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := computeMovement(tc.m, tc.cur)
			rec := httptest.NewRecorder()
			httpx.WriteError(rec, httptest.NewRequest(http.MethodPost, "/v1/commerce/stock/movements", nil), nil, err)

			if rec.Code != http.StatusConflict {
				t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
			}
			var body struct {
				Error struct {
					Code    string         `json:"code"`
					Message string         `json:"message"`
					Details map[string]any `json:"details"`
				} `json:"error"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode: %v (%s)", err, rec.Body.String())
			}
			if body.Error.Code != "insufficient_stock" {
				t.Fatalf("code %q", body.Error.Code)
			}
			if !hasCyrillic(body.Error.Message) {
				t.Fatalf("message must be Russian, got %q", body.Error.Message)
			}
			if body.Error.Details["product_id"] != testProductID.String() || body.Error.Details["location_id"] != testLocationID.String() {
				t.Fatalf("details %+v", body.Error.Details)
			}
		})
	}
}

func TestComputeMovementAppliesWithinAvailable(t *testing.T) {
	cases := []struct {
		name          string
		m             domain.StockMovement
		cur           StockState
		want          StockState
		wantQty       float64
		before, after float64
	}{
		{"receipt", movement(domain.MovementReceipt, 5), StockState{OnHand: 1}, StockState{OnHand: 6}, 5, 1, 6},
		{"write_off exact available", movement(domain.MovementWriteOff, -5), StockState{OnHand: 5}, StockState{OnHand: 0}, -5, 5, 0},
		{"write_off leaves reserved untouched", movement(domain.MovementWriteOff, -2), StockState{OnHand: 10, Reserved: 8}, StockState{OnHand: 8, Reserved: 8}, -2, 10, 8},
		{"reserve within available", movement(domain.MovementReserve, 3), StockState{OnHand: 10, Reserved: 7}, StockState{OnHand: 10, Reserved: 10}, 3, 7, 10},
		{"shipment consumes reservation and stock", movement(domain.MovementShipment, 4), StockState{OnHand: 10, Reserved: 4}, StockState{OnHand: 6, Reserved: 0}, 4, 10, 6},
		{"release clamps to reserved", movement(domain.MovementRelease, 9), StockState{OnHand: 10, Reserved: 4}, StockState{OnHand: 10, Reserved: 0}, 4, 4, 0},
		{"positive adjustment", movement(domain.MovementAdjust, 2), StockState{OnHand: 3, Reserved: 3}, StockState{OnHand: 5, Reserved: 3}, 2, 3, 5},
		{"damage does not move balances", movement(domain.MovementDamage, 1), StockState{OnHand: 3, Reserved: 1}, StockState{OnHand: 3, Reserved: 1}, 1, 3, 3},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := computeMovement(tc.m, tc.cur)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.State != tc.want || got.Qty != tc.wantQty || got.Before != tc.before || got.After != tc.after {
				t.Fatalf("got %+v", got)
			}
		})
	}
}

func TestComputeMovementInvalidInputIsNotAStockError(t *testing.T) {
	for _, m := range []domain.StockMovement{
		movement(domain.MovementReserve, 0),
		movement(domain.MovementShipment, -1),
		movement("teleport", 1),
	} {
		_, err := computeMovement(m, StockState{OnHand: 10})
		ae, ok := apperr.As(err)
		if !ok || ae.HTTPStatus != http.StatusBadRequest {
			t.Fatalf("%s: want 400 validation, got %#v", m.Kind, err)
		}
	}
}

func hasCyrillic(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Cyrillic, r) {
			return true
		}
	}
	return false
}
