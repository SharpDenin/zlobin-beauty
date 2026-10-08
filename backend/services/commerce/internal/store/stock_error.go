package store

import (
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

// pgCheckViolation is SQLSTATE 23514.
const pgCheckViolation = "23514"

// InsufficientStockAt returns HTTP 409 insufficient_stock with product/location details.
func InsufficientStockAt(productID, locationID uuid.UUID) *apperr.AppError {
	details := map[string]any{}
	if productID != uuid.Nil {
		details["product_id"] = productID.String()
	}
	if locationID != uuid.Nil {
		details["location_id"] = locationID.String()
	}
	return apperr.InsufficientStock("Недостаточно товара на складе").WithDetails(details)
}

// MapStockError converts a failure from a stock write into a typed error:
//   - an AppError passes through (an insufficient_stock without details gains product/location);
//   - a CHECK violation on stock_balances becomes insufficient_stock (409);
//   - a legacy English "out of stock" text from a lower layer becomes insufficient_stock (409).
//
// Anything else is returned unchanged so callers keep their own handling (500 internal).
func MapStockError(err error, productID, locationID uuid.UUID) error {
	if err == nil {
		return nil
	}
	if ae, ok := apperr.As(err); ok {
		if ae.Code == apperr.CodeInsufficientStock && ae.Details == nil {
			return InsufficientStockAt(productID, locationID)
		}
		return ae
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		if pgErr.Code == pgCheckViolation && isStockBalanceConstraint(pgErr) {
			return InsufficientStockAt(productID, locationID)
		}
		if looksLikeLegacyStockShortage(pgErr.Message + " " + pgErr.Detail) {
			return InsufficientStockAt(productID, locationID)
		}
		return err
	}
	if looksLikeLegacyStockShortage(err.Error()) {
		return InsufficientStockAt(productID, locationID)
	}
	return err
}

func isStockBalanceConstraint(e *pgconn.PgError) bool {
	return e.TableName == "stock_balances" || strings.HasPrefix(e.ConstraintName, "stock_balances_")
}

// looksLikeLegacyStockShortage matches the English/Russian shortage texts that
// older builds or database-side rules used to surface verbatim.
func looksLikeLegacyStockShortage(msg string) bool {
	m := strings.ToLower(msg)
	switch {
	case strings.Contains(m, "out of stock"):
		return true
	case strings.Contains(m, "insufficient") && strings.Contains(m, "stock"):
		return true
	case strings.Contains(m, "недостаточно товара"):
		return true
	}
	return false
}
