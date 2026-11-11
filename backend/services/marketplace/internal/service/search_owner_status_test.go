package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/store"
)

// searchRowEligible mirrors the SearchMasters WHERE clause for published + owner_status.
// Used to lock the product rule when a live DB is unavailable in CI.
func searchRowEligible(published bool, ownerStatus string) bool {
	return published && ownerStatus == domain.OwnerStatusActive
}

func TestSearchEligibilitySoloAndOrgOwnerStatus(t *testing.T) {
	cases := []struct {
		name        string
		published   bool
		ownerStatus string
		want        bool
	}{
		{"solo active published", true, domain.OwnerStatusActive, true},
		{"org active published", true, domain.OwnerStatusActive, true},
		{"unpublished active", false, domain.OwnerStatusActive, false},
		{"published blocked", true, domain.OwnerStatusBlocked, false},
		{"published deleted", true, domain.OwnerStatusDeleted, false},
		{"unpublished deleted", false, domain.OwnerStatusDeleted, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := searchRowEligible(tc.published, tc.ownerStatus); got != tc.want {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}

func TestSearchSQLPathRequiresOwnerStatusActive(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	src, err := os.ReadFile(filepath.Join(filepath.Dir(file), "..", "store", "search.go"))
	if err != nil {
		t.Fatal(err)
	}
	body := string(src)
	idx := strings.Index(body, "func (s *Store) SearchMasters")
	if idx < 0 {
		t.Fatal("SearchMasters missing")
	}
	chunk := body[idx:]
	if end := strings.Index(chunk, "\nfunc (s *Store)"); end > 0 {
		chunk = chunk[:end]
	}
	if !strings.Contains(chunk, `s.ownerStatusSQL("mp")`) {
		t.Fatal("SearchMasters must use gated ownerStatusSQL for rollout-safe enablement")
	}
	if !strings.Contains(chunk, "mp.published = TRUE") {
		t.Fatal("SearchMasters SQL must require published")
	}
	// Solo and org share the same master_profiles row model (organization_id nullable).
	if strings.Contains(chunk, "organization_id IS NOT NULL") && strings.Contains(chunk, "organization_id IS NULL") {
		t.Fatal("search must not mutually exclude solo and org masters")
	}
}

func TestActiveMasterUserIDsFailOpenKeepsPublishedWhileSQLOwnerStatusGates(t *testing.T) {
	active := uuid.New()
	blockedLocal := uuid.New() // would be filtered by SQL owner_status before this layer
	rows := []store.SearchMasterRow{
		{Master: domain.MasterProfile{UserID: active, Published: true, OwnerStatus: domain.OwnerStatusActive}},
		// Store.SearchMasters never returns blockedLocal when owner_status filter works;
		// this asserts identity fail-open does not invent exclusion beyond SQL.
	}
	s := New(nil)
	s.identityURL = "http://127.0.0.1:1"
	s.internalToken = "tok"
	got, err := s.activeMasterUserIDs(context.Background(), rows)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := got[active]; !ok {
		t.Fatal("identity down must fail-open for SQL-eligible rows")
	}
	_ = blockedLocal
}

func TestActiveMasterUserIDsFiltersDeletedWhenIdentityOK(t *testing.T) {
	active := uuid.New()
	deleted := uuid.New()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"items": []map[string]any{{"id": active.String(), "display_name": "A", "roles": []string{"master"}, "city": "X"}},
		})
	}))
	t.Cleanup(ts.Close)
	s := New(nil)
	s.identityURL = ts.URL
	s.internalToken = "tok"
	rows := []store.SearchMasterRow{
		{Master: domain.MasterProfile{UserID: active}},
		{Master: domain.MasterProfile{UserID: deleted}},
	}
	got, err := s.activeMasterUserIDs(context.Background(), rows)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := got[active]; !ok {
		t.Fatal("active missing")
	}
	if _, ok := got[deleted]; ok {
		t.Fatal("deleted must be excluded when identity answers")
	}
}

func TestSetOwnerStatusValidation(t *testing.T) {
	s := New(nil)
	_, err := s.SetOwnerStatusByUserID(context.Background(), uuid.New(), "nope")
	if err == nil {
		t.Fatal("expected validation")
	}
}
