package service

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

// typedOrInternal is the last step before httpx.WriteError: typed stock errors must
// survive, everything else must be hidden behind internal_error (never raw DB text).
func TestTypedOrInternalKeepsInsufficientStock(t *testing.T) {
	pid, lid := uuid.New(), uuid.New()
	err := typedOrInternal(store.InsufficientStockAt(pid, lid))
	ae, ok := apperr.As(err)
	if !ok || ae.HTTPStatus != http.StatusConflict || ae.Code != apperr.CodeInsufficientStock {
		t.Fatalf("got %#v", err)
	}
	if ae.Details["product_id"] != pid.String() || ae.Details["location_id"] != lid.String() {
		t.Fatalf("details %+v", ae.Details)
	}
}

func TestTypedOrInternalHidesRawErrors(t *testing.T) {
	ae, ok := apperr.As(typedOrInternal(errors.New(`ERROR: relation "stock_balances" does not exist`)))
	if !ok || ae.HTTPStatus != http.StatusInternalServerError {
		t.Fatalf("got %+v", ae)
	}
	if typedOrInternal(nil) != nil {
		t.Fatal("nil must stay nil")
	}
}

func TestReserveMovementsBuildsOneReservationPerLine(t *testing.T) {
	actor, orderID, locID := uuid.New(), uuid.New(), uuid.New()
	p1, p2 := uuid.New(), uuid.New()
	items := []domain.SupplierOrderItem{
		{ProductID: p1, QtyOrdered: 2},
		{ProductID: p2, QtyOrdered: 3.5},
	}
	got := reserveMovements(actor, orderID, locID, items, time.Now().UTC())
	if len(got) != 2 {
		t.Fatalf("want 2 movements, got %d", len(got))
	}
	for i, m := range got {
		if m.Kind != domain.MovementReserve || m.LocationID != locID || m.ActorUserID != actor {
			t.Fatalf("movement %d: %+v", i, m)
		}
		if m.RefType != "supplier_order" || m.RefID == nil || *m.RefID != orderID {
			t.Fatalf("movement %d must reference the order: %+v", i, m)
		}
		if m.Qty != items[i].QtyOrdered || m.ProductID != items[i].ProductID {
			t.Fatalf("movement %d: %+v", i, m)
		}
	}
}
