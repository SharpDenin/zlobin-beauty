package httpx

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/auth"
)

func TestCORSAllowsIdempotencyKey(t *testing.T) {
	handler := CORS([]string{"http://localhost:5173"})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("preflight must not reach the application handler")
	}))
	req := httptest.NewRequest(http.MethodOptions, "/v1/appointments", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Access-Control-Request-Headers", "authorization,content-type,idempotency-key")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	if got := rec.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(strings.ToLower(got), "idempotency-key") {
		t.Fatalf("Access-Control-Allow-Headers = %q, missing Idempotency-Key", got)
	}
}

func TestWriteErrorIncludesCodeAndOptionalDetails(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/v1/appointments", nil)
	rec := httptest.NewRecorder()

	err := apperr.ConflictCode(apperr.CodeAppointmentTimeConflict, "selected time is not available").
		WithDetails(map[string]any{"slot": "taken"})
	WriteError(rec, req, nil, err)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status=%d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"code":"appointment_time_conflict"`) {
		t.Fatalf("body=%s", body)
	}
	if !strings.Contains(body, `"details"`) {
		t.Fatalf("expected details in %s", body)
	}
	if strings.Contains(strings.ToLower(body), "postgres") {
		t.Fatal("must not leak database text")
	}
}

func TestWriteErrorInternalHidesCause(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/x", nil)
	rec := httptest.NewRecorder()
	WriteError(rec, req, nil, apperr.Internal(errors.New("SQLSTATE 23505 constraint violation")))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d", rec.Code)
	}
	body := rec.Body.String()
	if strings.Contains(body, "SQLSTATE") || strings.Contains(body, "constraint") {
		t.Fatalf("leaked cause: %s", body)
	}
	if !strings.Contains(body, `"code":"internal_error"`) {
		t.Fatalf("body=%s", body)
	}
}

func TestRequireSystemAdmin(t *testing.T) {
	secret := "test-secret-for-admin-gate-32ch"
	okHandler := RequireSystemAdmin(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	wrapped := BearerAuth(secret)(okHandler)

	clientPair, err := auth.IssuePair(secret, uuid.MustParse("11111111-1111-1111-1111-111111111111"), []string{"client"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/v1/admin/users", nil)
	req.Header.Set("Authorization", "Bearer "+clientPair.AccessToken)
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("client status=%d", rec.Code)
	}

	adminPair, err := auth.IssuePair(secret, uuid.MustParse("22222222-2222-2222-2222-222222222222"), []string{"system_admin"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodGet, "/v1/admin/users", nil)
	req.Header.Set("Authorization", "Bearer "+adminPair.AccessToken)
	rec = httptest.NewRecorder()
	wrapped.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("admin status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestParseOptionalUUIDAndBool(t *testing.T) {
	id := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	got, err := ParseOptionalUUID(id.String())
	if err != nil || got == nil || *got != id {
		t.Fatalf("uuid: %v %v", got, err)
	}
	empty, err := ParseOptionalUUID("")
	if err != nil || empty != nil {
		t.Fatal("empty uuid")
	}
	if _, err := ParseOptionalUUID("nope"); err == nil {
		t.Fatal("invalid uuid")
	}
	tru, err := ParseOptionalBool("true")
	if err != nil || tru == nil || !*tru {
		t.Fatal("true")
	}
	if _, err := ParseOptionalBool("maybe"); err == nil {
		t.Fatal("invalid bool")
	}
}

func TestParsePage(t *testing.T) {
	limit, offset := ParsePage("", "")
	if limit != 20 || offset != 0 {
		t.Fatalf("defaults %d %d", limit, offset)
	}
	limit, offset = ParsePage("500", "-3")
	if limit != 100 || offset != 0 {
		t.Fatalf("clamp %d %d", limit, offset)
	}
	limit, offset = ParsePage("10", "20")
	if limit != 10 || offset != 20 {
		t.Fatalf("parsed %d %d", limit, offset)
	}
}

