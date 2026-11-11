package store

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSetOwnerStatusSQLContract(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	src, err := os.ReadFile(filepath.Join(filepath.Dir(file), "admin.go"))
	if err != nil {
		t.Fatal(err)
	}
	body := string(src)
	for _, frag := range []string{
		"func (s *Store) SetOwnerStatusByUser",
		"owner_status = $2",
		"WHEN $2 = 'deleted' THEN FALSE",
		"WHERE user_id = $1",
	} {
		if !strings.Contains(body, frag) {
			t.Fatalf("SetOwnerStatusByUser missing %q", frag)
		}
	}
	if !strings.Contains(body, "UnpublishMasterByUser") || !strings.Contains(body, `SetOwnerStatusByUser(ctx, userID, "deleted"`) {
		t.Fatal("UnpublishMasterByUser must set owner_status deleted via SetOwnerStatusByUser")
	}
}

func TestOwnerStatusMigrationPresent(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	mig := filepath.Join(filepath.Dir(file), "..", "..", "migrations", "021_owner_status.sql")
	raw, err := os.ReadFile(mig)
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	for _, frag := range []string{
		"owner_status",
		"'active'",
		"'blocked'",
		"'deleted'",
	} {
		if !strings.Contains(body, frag) {
			t.Fatalf("migration missing %q", frag)
		}
	}
}
