package service

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestSyncMarketplaceOwnerStatusSkippedWithoutDeps(t *testing.T) {
	s := New(nil, "secret")
	if err := s.syncMarketplaceOwnerStatus(t.Context(), uuid.New(), "blocked"); err != nil {
		t.Fatal(err)
	}
}

func TestSyncMarketplaceOwnerStatusPUT(t *testing.T) {
	var gotMethod, gotPath, gotBody, gotTok string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotTok = r.Header.Get("X-Internal-Token")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"updated":true}`))
	}))
	t.Cleanup(ts.Close)

	uid := uuid.New()
	s := New(nil, "secret").WithAccountDeleteDeps("", "", ts.URL, "tok")
	if err := s.syncMarketplaceOwnerStatus(t.Context(), uid, "blocked"); err != nil {
		t.Fatal(err)
	}
	if gotMethod != http.MethodPut {
		t.Fatalf("method %s", gotMethod)
	}
	if !strings.Contains(gotPath, uid.String()+"/owner-status") {
		t.Fatalf("path %s", gotPath)
	}
	if gotTok != "tok" {
		t.Fatalf("token %q", gotTok)
	}
	var payload map[string]string
	if err := json.Unmarshal([]byte(gotBody), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["status"] != "blocked" {
		t.Fatalf("body %#v", payload)
	}
}

func TestSyncMarketplaceOwnerStatusFailsClosedOnHTTPError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	t.Cleanup(ts.Close)
	s := New(nil, "secret").WithAccountDeleteDeps("", "", ts.URL, "tok")
	if err := s.syncMarketplaceOwnerStatus(t.Context(), uuid.New(), "blocked"); err == nil {
		t.Fatal("expected error")
	}
}
