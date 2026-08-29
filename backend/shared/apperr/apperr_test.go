package apperr

import (
	"errors"
	"net/http"
	"testing"
)

func TestDomainCodes(t *testing.T) {
	cases := []struct {
		err    *AppError
		code   Code
		status int
	}{
		{InvalidCredentials(), CodeInvalidCredentials, http.StatusUnauthorized},
		{EmailTaken(), CodeEmailTaken, http.StatusConflict},
		{AccountBlocked(), CodeAccountBlocked, http.StatusForbidden},
		{SessionExpired(), CodeSessionExpired, http.StatusUnauthorized},
		{ConflictCode(CodeAppointmentTimeConflict, "slot taken"), CodeAppointmentTimeConflict, http.StatusConflict},
		{ValidationCode(CodeMediaTooLarge, "too large"), CodeMediaTooLarge, http.StatusBadRequest},
		{InsufficientStock(""), CodeInsufficientStock, http.StatusConflict},
	}
	for _, tc := range cases {
		if tc.err.Code != tc.code {
			t.Fatalf("code=%s want %s", tc.err.Code, tc.code)
		}
		if tc.err.HTTPStatus != tc.status {
			t.Fatalf("status=%d want %d for %s", tc.err.HTTPStatus, tc.status, tc.code)
		}
	}
}

func TestWithDetails(t *testing.T) {
	err := Validation("name is required").WithDetails(map[string]any{
		"fields": map[string]string{"name": "required"},
	})
	if err.Details["fields"] == nil {
		t.Fatal("expected details.fields")
	}
}

func TestInternalNeverLeaksCause(t *testing.T) {
	err := Internal(errors.New("SQLSTATE 23505"))
	if err.Message != "internal error" {
		t.Fatalf("message=%q", err.Message)
	}
	if err.Code != CodeInternal {
		t.Fatalf("code=%s", err.Code)
	}
}
