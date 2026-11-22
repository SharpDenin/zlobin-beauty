package service

import (
	"testing"

	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/domain"
)

func TestContactDisplayFallback(t *testing.T) {
	if got := contactDisplay("+79001112233", "admin"); got != "+79001112233" {
		t.Fatalf("got %q", got)
	}
	if got := contactDisplay("  ", "none"); got != "Свяжитесь с салоном через приложение" {
		t.Fatalf("empty phone display = %q", got)
	}
	if got := contactDisplay("", "branch"); got != "Свяжитесь с салоном через приложение" {
		t.Fatalf("missing phone display = %q", got)
	}
}

func TestBranchCloseCancelReason(t *testing.T) {
	if domain.BranchCloseCancelReason != "филиал закрыт" {
		t.Fatalf("reason = %q", domain.BranchCloseCancelReason)
	}
}
