package store

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestInsufficientStockAtTyped(t *testing.T) {
	pid := uuid.MustParse("018f0000-0000-7000-8000-000000000001")
	lid := uuid.MustParse("018f0000-0000-7000-8000-000000000002")
	err := InsufficientStockAt(pid, lid)
	if err.HTTPStatus != http.StatusConflict {
		t.Fatalf("status %d", err.HTTPStatus)
	}
	if err.Code != apperr.CodeInsufficientStock {
		t.Fatalf("code %s", err.Code)
	}
	if err.Details["product_id"] != pid.String() || err.Details["location_id"] != lid.String() {
		t.Fatalf("details %+v", err.Details)
	}
}

func TestMapStockErrorPostgres(t *testing.T) {
	pid := uuid.MustParse("018f0000-0000-7000-8000-000000000003")
	lid := uuid.MustParse("018f0000-0000-7000-8000-000000000004")

	shortage := []*pgconn.PgError{
		{Code: pgCheckViolation, TableName: "stock_balances", ConstraintName: "stock_balances_qty_nonneg", Message: "new row violates check constraint"},
		{Code: pgCheckViolation, ConstraintName: "stock_balances_qty_nonneg"},
		{Code: "P0001", Message: "insufficient out of stock at location"},
	}
	for _, pg := range shortage {
		mapped := MapStockError(pg, pid, lid)
		ae, ok := apperr.As(mapped)
		if !ok || ae.Code != apperr.CodeInsufficientStock || ae.HTTPStatus != http.StatusConflict {
			t.Fatalf("%+v => %#v", pg, mapped)
		}
		if ae.Details["product_id"] != pid.String() || ae.Details["location_id"] != lid.String() {
			t.Fatalf("details %+v", ae.Details)
		}
	}

	unrelated := []*pgconn.PgError{
		// a CHECK on another table is not a stock shortage
		{Code: pgCheckViolation, TableName: "consumption_norms", ConstraintName: "consumption_norms_qty_check"},
		// NOT NULL violations are programming errors, not shortages
		{Code: "23502", TableName: "stock_balances", Message: `null value in column "qty_on_hand"`},
		{Code: "42501", Message: "permission denied for table stock_balances"},
		{Code: "23505", Message: "duplicate key value violates unique constraint"},
	}
	for _, pg := range unrelated {
		mapped := MapStockError(pg, pid, lid)
		if _, ok := apperr.As(mapped); ok {
			t.Fatalf("%+v must not become a typed error, got %#v", pg, mapped)
		}
		if !errors.Is(mapped, pg) {
			t.Fatalf("%+v must be returned unchanged, got %#v", pg, mapped)
		}
	}
}

func TestMapStockErrorLegacyEnglish(t *testing.T) {
	pid, lid := uuid.New(), uuid.New()
	shortage := []string{
		"insufficient out of stock at location",
		"Out of stock at location warehouse-1",
		"insufficient stock for product",
		"недостаточно товара на складе",
	}
	for _, msg := range shortage {
		ae, ok := apperr.As(MapStockError(errors.New(msg), pid, lid))
		if !ok || ae.Code != apperr.CodeInsufficientStock || ae.HTTPStatus != http.StatusConflict {
			t.Fatalf("%q => %+v", msg, ae)
		}
	}

	// Words that merely share a table/column name or a generic adjective are not shortages.
	unrelated := []string{
		"insufficient privileges",
		"connection reset by peer",
		"failed to scan qty_on_hand",
		"stock_balances relation does not exist",
	}
	for _, msg := range unrelated {
		err := errors.New(msg)
		if mapped := MapStockError(err, pid, lid); mapped != err {
			t.Fatalf("%q must pass through, got %#v", msg, mapped)
		}
	}
}

func TestMapStockErrorKeepsTypedErrors(t *testing.T) {
	pid, lid := uuid.New(), uuid.New()

	bare := apperr.InsufficientStock("Недостаточно товара на складе")
	ae, ok := apperr.As(MapStockError(bare, pid, lid))
	if !ok || ae.Details["product_id"] != pid.String() {
		t.Fatalf("bare insufficient_stock must gain details, got %+v", ae)
	}

	validation := apperr.Validation("qty must be positive for reserve")
	if got := MapStockError(validation, pid, lid); got != error(validation) {
		t.Fatalf("validation must pass through, got %#v", got)
	}

	wrapped := fmt.Errorf("apply: %w", apperr.InsufficientStock("x").WithDetails(map[string]any{"product_id": "p"}))
	ae, ok = apperr.As(MapStockError(wrapped, pid, lid))
	if !ok || ae.Details["product_id"] != "p" {
		t.Fatalf("existing details must be preserved, got %+v", ae)
	}

	if MapStockError(nil, pid, lid) != nil {
		t.Fatal("nil must stay nil")
	}
}
