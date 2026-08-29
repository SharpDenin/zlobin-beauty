package store

import (
	"errors"
	"testing"

	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestMapAppointmentConflictExclusion(t *testing.T) {
	err := mapAppointmentConflict(&pgconn.PgError{Code: pgerrcode.ExclusionViolation})
	ae, ok := apperr.As(err)
	if !ok {
		t.Fatal("expected apperr")
	}
	if ae.Code != apperr.CodeAppointmentTimeConflict {
		t.Fatalf("code=%v want appointment_time_conflict", ae.Code)
	}
	if ae.Message != slotConflictMsg {
		t.Fatalf("message=%q want %q", ae.Message, slotConflictMsg)
	}

	raw := errors.New("other")
	if mapAppointmentConflict(raw) != raw {
		t.Fatal("non-pg errors must pass through")
	}
}
