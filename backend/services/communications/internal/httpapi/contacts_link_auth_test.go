package httpapi

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/service"
)

func TestInternalContactsLinkRequiresToken(t *testing.T) {
	api := New(&service.Service{}, slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})), "secret-token")
	mux := http.NewServeMux()
	api.Routes(mux, "jwt-not-used-here")

	body := []byte(`{"user_a":"11111111-1111-4111-8111-111111111111","user_b":"22222222-2222-4222-8222-222222222222"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/contacts/link", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("without token: want 401, got %d body=%s", rr.Code, rr.Body.String())
	}

	req2 := httptest.NewRequest(http.MethodPost, "/v1/internal/contacts/link", bytes.NewReader(body))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("X-Internal-Token", "wrong")
	rr2 := httptest.NewRecorder()
	mux.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusUnauthorized {
		t.Fatalf("wrong token: want 401, got %d", rr2.Code)
	}
}
