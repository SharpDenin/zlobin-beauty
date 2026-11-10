package httpapi

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func TestDeleteAccountRequiresAuth(t *testing.T) {
	api := New(nil, slog.Default())
	mux := http.NewServeMux()
	api.Routes(mux, "test-jwt-secret-32-chars-minimum!")

	body, _ := json.Marshal(map[string]string{"password": "x"})
	req := httptest.NewRequest(http.MethodDelete, "/v1/auth/account", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestDeleteAccountRouteRegistered(t *testing.T) {
	api := New(nil, slog.Default())
	mux := http.NewServeMux()
	secret := "test-jwt-secret-32-chars-minimum!"
	api.Routes(mux, secret)

	// Invalid token still hits the route (not 404).
	req := httptest.NewRequest(http.MethodDelete, "/v1/auth/account", bytes.NewReader([]byte(`{"password":"x"}`)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer not-a-jwt")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code == http.StatusNotFound {
		t.Fatal("DELETE /v1/auth/account must be registered")
	}
	if rec.Code != http.StatusUnauthorized {
		// BearerAuth may return 401; ensure httpx path works.
		_ = httpx.BearerAuth
		t.Fatalf("expected unauthorized, got %d", rec.Code)
	}
}
