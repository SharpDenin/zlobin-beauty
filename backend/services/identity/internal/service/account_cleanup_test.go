package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestRunAccountCleanupMarksFailedSteps(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/internal/users/", func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && strings.Contains(r.URL.Path, "deactivate-memberships"):
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"deactivated":1}`))
		case r.Method == http.MethodDelete && strings.Contains(r.URL.Path, "push-subscriptions"):
			http.Error(w, "down", http.StatusServiceUnavailable)
		case r.Method == http.MethodPost && strings.Contains(r.URL.Path, "unpublish-master"):
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"unpublished":true}`))
		default:
			http.NotFound(w, r)
		}
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	s := New(nil, "secret").WithAccountDeleteDeps(srv.URL, srv.URL, srv.URL, "tok")
	res, err := s.RunAccountCleanup(t.Context(), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if res.Memberships != "ok" || res.Master != "ok" || res.Push != "failed" {
		t.Fatalf("unexpected %#v", res)
	}
	if len(res.Failed) != 1 || res.Failed[0] != "push" {
		t.Fatalf("failed=%v", res.Failed)
	}
}

func TestRunAccountCleanupSkippedWithoutDeps(t *testing.T) {
	s := New(nil, "secret")
	res, err := s.RunAccountCleanup(t.Context(), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if res.Memberships != "skipped" || res.Push != "skipped" || res.Master != "skipped" {
		t.Fatalf("%#v", res)
	}
	if len(res.Failed) != 0 {
		t.Fatalf("failed=%v", res.Failed)
	}
}

func TestAccountCleanupFailedError(t *testing.T) {
	ae := apperr.AccountCleanupFailed([]string{"push", "master"})
	if ae.HTTPStatus != http.StatusServiceUnavailable {
		t.Fatalf("status %d", ae.HTTPStatus)
	}
	raw, _ := json.Marshal(ae.Details)
	if !strings.Contains(string(raw), "push") {
		t.Fatalf("details %s", raw)
	}
}
