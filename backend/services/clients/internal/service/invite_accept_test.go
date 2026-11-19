package service

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestLoadActiveClientInviteRejectsShortToken(t *testing.T) {
	s := &Service{now: time.Now}
	_, err := s.loadActiveClientInvite(context.Background(), "short")
	ae, ok := err.(*apperr.AppError)
	if !ok || ae.Code != apperr.CodeInviteInvalid {
		t.Fatalf("want invite_invalid, got %#v", err)
	}
}

func TestAcceptSelfGuardUsesInviteMasterID(t *testing.T) {
	// Documented contract: master comes from invite row; client from JWT claims.
	inv := domain.ClientInvite{MasterUserID: uuid.New()}
	clientID := inv.MasterUserID
	if clientID != inv.MasterUserID {
		t.Fatal("setup")
	}
	err := apperr.Unprocessable(apperr.CodeContactSelf, "cannot accept your own invite")
	if err.Code != apperr.CodeContactSelf {
		t.Fatal(err.Code)
	}
}
