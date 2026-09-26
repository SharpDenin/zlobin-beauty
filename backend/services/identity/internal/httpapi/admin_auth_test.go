package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/auth"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func TestAdminUsersForbiddenForNonPlatformRoles(t *testing.T) {
	secret := "test-jwt-secret-32-chars-minimum"
	mux := http.NewServeMux()
	api := &API{}
	api.registerAdminRoutes(mux, httpx.BearerAuth(secret))

	roles := [][]string{
		{"client"},
		{"master"},
		{"supplier"},
		{"salon_admin"},
		{"salon_owner"},
	}
	for _, role := range roles {
		tok, _, err := auth.IssueAccessToken(secret, uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), uuid.New(), role, time.Now())
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodGet, "/v1/admin/users", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("role %v status=%d want 403 body=%s", role, rec.Code, rec.Body.String())
		}
		var body map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		errObj, _ := body["error"].(map[string]any)
		if errObj == nil || errObj["code"] == nil {
			t.Fatalf("expected error envelope for %v: %s", role, rec.Body.String())
		}
	}
}

func TestAdminUsersUnauthorizedWithoutToken(t *testing.T) {
	mux := http.NewServeMux()
	api := &API{}
	api.registerAdminRoutes(mux, httpx.BearerAuth("test-jwt-secret-32-chars-minimum"))
	req := httptest.NewRequest(http.MethodGet, "/v1/admin/users", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized && rec.Code != 401 {
		t.Fatalf("status=%d want 401", rec.Code)
	}
}
