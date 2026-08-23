package domain

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestFormatClientOrderNumber(t *testing.T) {
	id := uuid.MustParse("01234567-89ab-cdef-0123-456789abcdef")
	created := time.Date(2026, 8, 18, 12, 0, 0, 0, time.UTC)
	got := FormatClientOrderNumber(id, created)
	if got != "CL-20260818-01234567" {
		t.Fatalf("unexpected order number: %q", got)
	}
}
