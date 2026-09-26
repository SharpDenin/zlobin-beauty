package service

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestValidateAdminUserStatusChange(t *testing.T) {
	actor := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	target := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	if err := ValidateAdminUserStatusChange(actor, actor, nil, "blocked", "spam"); err == nil {
		t.Fatal("self block must fail")
	}
	if err := ValidateAdminUserStatusChange(actor, target, []string{domain.RoleSystemAdmin}, "blocked", "spam"); err == nil {
		t.Fatal("admin block must fail")
	}
	if err := ValidateAdminUserStatusChange(actor, target, []string{domain.RoleClient}, "blocked", ""); err == nil {
		t.Fatal("reason required")
	}
	if err := ValidateAdminUserStatusChange(actor, target, []string{domain.RoleClient}, "blocked", "spam"); err != nil {
		t.Fatal(err)
	}
	if err := ValidateAdminUserStatusChange(actor, target, []string{domain.RoleMaster}, "active", ""); err != nil {
		t.Fatal(err)
	}
	ae, ok := apperr.As(ValidateAdminUserStatusChange(actor, target, nil, "deleted", "x"))
	if !ok || ae.HTTPStatus != 400 {
		t.Fatal("invalid status")
	}
}

func TestSanitizeAuditMetaStripsSecrets(t *testing.T) {
	got := string(SanitizeAuditMeta([]byte(`{"reason":"spam","password":"x","token":"abc"}`)))
	if !strings.Contains(got, "spam") {
		t.Fatalf("kept reason: %s", got)
	}
	if strings.Contains(got, "password") || strings.Contains(got, "token") {
		t.Fatalf("leaked secret: %s", got)
	}
}
