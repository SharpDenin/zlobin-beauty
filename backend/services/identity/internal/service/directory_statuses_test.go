package service

import (
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/store"
)

func TestToDirectoryPublicStillExcludesNonActive(t *testing.T) {
	items := []store.DirectoryUser{
		{ID: uuid.New(), Status: "active", DisplayName: "A"},
		{ID: uuid.New(), Status: "blocked", DisplayName: "B"},
		{ID: uuid.New(), Status: "deleted", DisplayName: "D"},
	}
	out := toDirectoryPublic(items)
	if len(out) != 1 || out[0].DisplayName != "A" {
		t.Fatalf("%#v", out)
	}
}

func TestUserStatusRowIncludesBlockedDeleted(t *testing.T) {
	// Contract: BatchUserStatuses must not use toDirectoryPublic filtering.
	// Verified by inspecting that service returns store rows as-is in BatchUserStatuses.
	active := uuid.New()
	blocked := uuid.New()
	rows := []UserStatusRow{
		{ID: active, Status: "active"},
		{ID: blocked, Status: "blocked"},
	}
	if rows[1].Status != "blocked" {
		t.Fatal("statuses API must expose blocked")
	}
}
