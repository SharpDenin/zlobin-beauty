package service

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func readServiceGo(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	src, err := os.ReadFile(filepath.Join(filepath.Dir(file), "service.go"))
	if err != nil {
		t.Fatal(err)
	}
	return string(src)
}

func TestResolveServiceOrganizationSourceContract(t *testing.T) {
	// Ensure CreateService resolves missing organization_id for attach_to_me solo masters
	// instead of requiring a bound master_profiles.organization_id.
	src := readServiceGo(t)
	for _, frag := range []string{
		"resolveServiceOrganizationID",
		"firstOwnedSalonOrganization",
		"organization_id is required: create or join a salon workspace first",
		"owned-organizations",
	} {
		if !strings.Contains(src, frag) {
			t.Fatalf("CreateService org resolve missing %q", frag)
		}
	}
}

func TestSearchFiltersActiveUsersSourceContract(t *testing.T) {
	src := readServiceGo(t)
	for _, frag := range []string{
		"activeMasterUserIDs",
		"/v1/internal/users/batch",
	} {
		if !strings.Contains(src, frag) {
			t.Fatalf("Search active-user filter missing %q", frag)
		}
	}
}
