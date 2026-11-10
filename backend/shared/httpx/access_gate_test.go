package httpx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/auth"
)

type staticGate struct{ err error }

func (g staticGate) Check(context.Context, *auth.Claims) error { return g.err }

func TestBearerAuthGatedRejectsRevokedSession(t *testing.T) {
	secret := "test-secret-for-access-gate-32ch!!"
	pair, err := auth.IssuePair(secret, uuid.New(), []string{"client"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	h := BearerAuthGated(secret, staticGate{err: apperr.SessionInvalid()})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+pair.AccessToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestBearerAuthGatedRejectsBlockedAccount(t *testing.T) {
	secret := "test-secret-for-access-gate-32ch!!"
	pair, err := auth.IssuePair(secret, uuid.New(), []string{"client"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	h := BearerAuthGated(secret, staticGate{err: apperr.AccountBlocked()})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodGet, "/v1/me/preferences", nil)
	req.Header.Set("Authorization", "Bearer "+pair.AccessToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestBearerAuthGatedAllowsActive(t *testing.T) {
	secret := "test-secret-for-access-gate-32ch!!"
	pair, err := auth.IssuePair(secret, uuid.New(), []string{"client"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	h := BearerAuthGated(secret, staticGate{err: nil})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+pair.AccessToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status=%d", rec.Code)
	}
}

func TestRequireBearerAccessPassesWithoutHeader(t *testing.T) {
	h := RequireBearerAccess("secret", staticGate{err: apperr.SessionInvalid()})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodGet, "/v1/masters", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("public route blocked: %d", rec.Code)
	}
}
