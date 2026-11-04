package service

import (
	"testing"

	"github.com/google/uuid"
)

func TestValidatePreferenceKey(t *testing.T) {
	good := []string{"calendar.view.mobile", "calendar.displayRange", "nav.order", "ui.theme", "ui.home_bg", "dashboard.mode", "messenger.sound", "forms.draft-hint"}
	for _, k := range good {
		if err := ValidatePreferenceKey(k); err != nil {
			t.Fatalf("%s should be valid: %v", k, err)
		}
	}
	bad := []string{"", "Calendar.view", "calendar", "auth.token", "calendar..x", "calendar.view/../x", "nav.", "x.y", "calendar.a.b.c.d.e.f.g"}
	for _, k := range bad {
		if err := ValidatePreferenceKey(k); err == nil {
			t.Fatalf("%q should be rejected", k)
		}
	}
}

func TestValidatePreferenceValue(t *testing.T) {
	if err := ValidatePreferenceValue([]byte(`{"from":"08:00","to":"22:00"}`)); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{"", "null", "{bad", string(make([]byte, maxPreferenceValueBytes+1))} {
		if err := ValidatePreferenceValue([]byte(raw)); err == nil {
			t.Fatalf("value %.12q should be rejected", raw)
		}
	}
}

func TestValidateHomeBgPreferenceSystem(t *testing.T) {
	s := New(nil, "secret")
	if err := s.validateHomeBgPreference(t.Context(), uuid.Nil, []byte(`{"source":"system","id":"mist-canyon"}`)); err != nil {
		t.Fatal(err)
	}
	if err := s.validateHomeBgPreference(t.Context(), uuid.Nil, []byte(`{"source":"system","id":"nope"}`)); err == nil {
		t.Fatal("unknown system wallpaper must be rejected")
	}
	if err := s.validateHomeBgPreference(t.Context(), uuid.Nil, []byte(`{"source":"custom","media_id":"not-a-uuid"}`)); err == nil {
		t.Fatal("invalid media_id must be rejected")
	}
}
