package service

import "testing"

func TestValidatePreferenceKey(t *testing.T) {
	good := []string{"calendar.view.mobile", "calendar.displayRange", "nav.order", "ui.theme", "dashboard.mode", "messenger.sound", "forms.draft-hint"}
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
