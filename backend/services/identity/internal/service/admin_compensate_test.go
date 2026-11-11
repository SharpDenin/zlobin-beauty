package service

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
)

func TestSyncMarketplaceOwnerStatusOrderHelpers(t *testing.T) {
	var puts atomic.Int32
	var lastStatus string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || !strings.Contains(r.URL.Path, "/owner-status") {
			http.NotFound(w, r)
			return
		}
		puts.Add(1)
		body, _ := io.ReadAll(r.Body)
		lastStatus = string(body)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(ts.Close)

	s := New(nil, "secret").WithAccountDeleteDeps("", "", ts.URL, "tok")
	uid := uuid.New()
	if err := s.syncMarketplaceOwnerStatus(t.Context(), uid, "blocked"); err != nil {
		t.Fatal(err)
	}
	if puts.Load() != 1 || !strings.Contains(lastStatus, "blocked") {
		t.Fatalf("puts=%d body=%s", puts.Load(), lastStatus)
	}
	// Compensation path uses the same helper with prior status.
	if err := s.syncMarketplaceOwnerStatus(t.Context(), uid, "active"); err != nil {
		t.Fatal(err)
	}
	if puts.Load() != 2 || !strings.Contains(lastStatus, "active") {
		t.Fatalf("compensate puts=%d body=%s", puts.Load(), lastStatus)
	}
}
