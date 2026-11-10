package accesscheck

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/auth"
)

func TestHTTPGateRejectsRevokedAndCachesNegative(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("X-Internal-Token") != "tok" {
			t.Fatalf("token")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"active": false, "reason": "session_revoked"})
	}))
	t.Cleanup(srv.Close)

	g := NewHTTPGate(srv.URL, "tok", WithPositiveTTL(0), WithNegativeTTL(time.Minute))
	claims := &auth.Claims{UserID: uuid.New(), SessionID: uuid.New()}
	err := g.Check(t.Context(), claims)
	ae, ok := apperr.As(err)
	if !ok || ae.Code != apperr.CodeSessionInvalid {
		t.Fatalf("got %v", err)
	}
	_ = g.Check(t.Context(), claims)
	if calls != 1 {
		t.Fatalf("expected negative cache hit, calls=%d", calls)
	}
}

func TestHTTPGateAllowsActive(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"active": true})
	}))
	t.Cleanup(srv.Close)
	g := NewHTTPGate(srv.URL, "tok", WithPositiveTTL(0))
	if err := g.Check(t.Context(), &auth.Claims{UserID: uuid.New(), SessionID: uuid.New()}); err != nil {
		t.Fatal(err)
	}
}

func TestHTTPGateAccountBlockedReason(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"active": false, "reason": "account_deleted"})
	}))
	t.Cleanup(srv.Close)
	g := NewHTTPGate(srv.URL, "tok", WithPositiveTTL(0))
	err := g.Check(t.Context(), &auth.Claims{UserID: uuid.New(), SessionID: uuid.New()})
	ae, ok := apperr.As(err)
	if !ok || ae.Code != apperr.CodeAccountBlocked {
		t.Fatalf("got %v", err)
	}
}

func TestHTTPGateFailClosedWithoutConfig(t *testing.T) {
	g := NewHTTPGate("", "", WithPositiveTTL(0))
	err := g.Check(t.Context(), &auth.Claims{UserID: uuid.New(), SessionID: uuid.New()})
	if err == nil {
		t.Fatal("expected deny")
	}
}
