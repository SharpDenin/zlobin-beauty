package service

import (
	"testing"

	"github.com/google/uuid"
)

func TestConversationKeysStable(t *testing.T) {
	a := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	b := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	if ContextKeyClientMaster(a, b) != ContextKeyClientMaster(b, a) {
		t.Fatal("client-master key must be order-independent")
	}
	org := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	if ContextKeyMasterSupplier(a, org) == ContextKeyMasterSupplier(b, org) {
		t.Fatal("different masters must not share a supplier conversation key")
	}
}
