package service

import (
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/store"
)

func TestToDirectoryPublicExcludesBlockedAndAdmin(t *testing.T) {
	adminID := uuid.New()
	blockedID := uuid.New()
	okID := uuid.New()
	items := []store.DirectoryUser{
		{ID: adminID, DisplayName: "Admin", Status: "active", Roles: []string{domain.RoleSystemAdmin, domain.RoleClient}},
		{ID: blockedID, DisplayName: "Blocked", Status: "blocked", Roles: []string{domain.RoleClient}},
		{ID: okID, DisplayName: "Ok", Status: "active", City: "Москва", Roles: []string{domain.RoleMaster}},
	}
	out := toDirectoryPublic(items)
	if len(out) != 1 || out[0].ID != okID {
		t.Fatalf("got %+v", out)
	}
	if hasRole(out[0].Roles, domain.RoleSystemAdmin) {
		t.Fatal("admin role must be stripped")
	}
}

func TestSanitizeRoles(t *testing.T) {
	got := sanitizeRoles([]string{domain.RoleClient, domain.RoleSystemAdmin, domain.RoleMaster})
	if len(got) != 2 {
		t.Fatalf("%v", got)
	}
}
