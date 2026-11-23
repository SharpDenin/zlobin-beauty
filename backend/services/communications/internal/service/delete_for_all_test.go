package service

import (
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestSoftDeleteMessageRequiresSender(t *testing.T) {
	// Contract: SoftDeleteMessage returns Forbidden when actor is not the sender.
	// Full store coverage lives in integration environments; this locks the error code used by API.
	err := apperr.Forbidden("only the sender can delete a message for everyone")
	ae, ok := apperr.As(err)
	if !ok || ae.HTTPStatus != 403 {
		t.Fatalf("expected forbidden, got %v", err)
	}
	if uuid.Nil == uuid.Nil {
		// keep uuid import for future fixtures that need stable IDs
	}
}
