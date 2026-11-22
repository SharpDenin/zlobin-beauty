package service

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestLinkMutualContactsRejectsSelf(t *testing.T) {
	s := &Service{}
	id := uuid.New()
	err := s.LinkMutualContacts(context.Background(), id, id, "")
	if err == nil {
		t.Fatal("expected self-link error")
	}
	ae, ok := err.(*apperr.AppError)
	if !ok || ae.Code != apperr.CodeContactSelf {
		t.Fatalf("want contact_self, got %#v", err)
	}
}

func TestLinkMutualContactsRequiresIDs(t *testing.T) {
	s := &Service{}
	err := s.LinkMutualContacts(context.Background(), uuid.Nil, uuid.New(), "")
	if err == nil {
		t.Fatal("expected validation")
	}
}
