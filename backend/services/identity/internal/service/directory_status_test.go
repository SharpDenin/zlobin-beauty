package service

import (
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/store"
)

func TestToDirectoryPublicExcludesNonActive(t *testing.T) {
	items := []store.DirectoryUser{
		{ID: uuid.New(), DisplayName: "Active", Status: "active", Roles: []string{"client"}},
		{ID: uuid.New(), DisplayName: "Blocked", Status: "blocked", Roles: []string{"client"}},
		{ID: uuid.New(), DisplayName: "Deleted", Status: "deleted", Roles: []string{"master"}},
	}
	out := toDirectoryPublic(items)
	if len(out) != 1 {
		t.Fatalf("want 1 active user, got %d", len(out))
	}
	if out[0].DisplayName != "Active" {
		t.Fatalf("got %+v", out[0])
	}
}
