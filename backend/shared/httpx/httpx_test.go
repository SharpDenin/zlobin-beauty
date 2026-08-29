package httpx

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
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
