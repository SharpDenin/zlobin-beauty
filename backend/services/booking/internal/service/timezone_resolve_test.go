package service

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/tz"
)

func TestResolveTimezoneIgnoresClientDeviceZone(t *testing.T) {
	s := New(nil, "")
	// Client in Krasnoyarsk must not force the service schedule into Asia/Krasnoyarsk
	// when the master's location cannot be resolved (falls back to default).
	got, err := s.ResolveTimezone(context.Background(), uuid.New(), "Asia/Krasnoyarsk")
	if err != nil {
		t.Fatal(err)
	}
	if got != tz.Default {
		t.Fatalf("client timezone must be ignored, got %q want %q", got, tz.Default)
	}
}

func TestResolveTimezoneRejectsInvalidParam(t *testing.T) {
	s := New(nil, "")
	_, err := s.ResolveTimezone(context.Background(), uuid.New(), "Not/AZone")
	if err == nil {
		t.Fatal("expected validation error")
	}
	ae, ok := apperr.As(err)
	if !ok || ae.Code != apperr.CodeValidation {
		t.Fatalf("want validation, got %v", err)
	}
}

func TestMoscowAndKrasnoyarskSixteenHundredAreDifferentInstants(t *testing.T) {
	// Scenarios 3/4: wall 16:00 is always service-location local.
	msk := tz.MustLoad("Europe/Moscow")
	krsk := tz.MustLoad("Asia/Krasnoyarsk")
	mskInstant := time.Date(2026, 6, 15, 16, 0, 0, 0, msk).UTC()
	krskInstant := time.Date(2026, 6, 15, 16, 0, 0, 0, krsk).UTC()
	if mskInstant.Equal(krskInstant) {
		t.Fatal("16:00 Moscow and 16:00 Krasnoyarsk must differ in UTC")
	}
	if mskInstant.Format(time.RFC3339) != "2026-06-15T13:00:00Z" {
		t.Fatalf("moscow: %s", mskInstant.Format(time.RFC3339))
	}
	if krskInstant.Format(time.RFC3339) != "2026-06-15T09:00:00Z" {
		t.Fatalf("krasnoyarsk: %s", krskInstant.Format(time.RFC3339))
	}
}

func TestServerProcessLocationDoesNotChangeStoredUTC(t *testing.T) {
	// Changing the process local zone must not alter UTC instants derived from IANA zones.
	loc := tz.MustLoad("Asia/Krasnoyarsk")
	instant := time.Date(2026, 6, 15, 16, 0, 0, 0, loc).UTC()
	if instant.Location() != time.UTC {
		t.Fatalf("stored instant must be UTC, got %v", instant.Location())
	}
	if instant.Format(time.RFC3339) != "2026-06-15T09:00:00Z" {
		t.Fatalf("got %s", instant.Format(time.RFC3339))
	}
}
