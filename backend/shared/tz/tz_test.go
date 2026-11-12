package tz

import (
	"testing"
	"time"
)

func TestTimezoneForCity(t *testing.T) {
	cases := []struct {
		city string
		want string
	}{
		{"Красноярск", "Asia/Krasnoyarsk"},
		{"  красноярск ", "Asia/Krasnoyarsk"},
		{"Новосибирск", "Asia/Novosibirsk"},
		{"Москва", "Europe/Moscow"},
		{"Unknownburg", ""},
	}
	for _, tc := range cases {
		if got := TimezoneForCity(tc.city); got != tc.want {
			t.Fatalf("TimezoneForCity(%q)=%q want %q", tc.city, got, tc.want)
		}
	}
}

func TestResolveForBranchRejectsSilentDefault(t *testing.T) {
	if _, err := ResolveForBranch("", "Владивосток"); err != ErrTimezoneRequired {
		t.Fatalf("want ErrTimezoneRequired, got %v", err)
	}
	got, err := ResolveForBranch("Asia/Vladivostok", "Владивосток")
	if err != nil || got != "Asia/Vladivostok" {
		t.Fatalf("explicit: got %q err %v", got, err)
	}
	got, err = ResolveForBranch("", "Красноярск")
	if err != nil || got != "Asia/Krasnoyarsk" {
		t.Fatalf("known city: got %q err %v", got, err)
	}
}

func TestResolvePrefersExplicitThenCity(t *testing.T) {
	if got := Resolve("Asia/Krasnoyarsk", "Москва"); got != "Asia/Krasnoyarsk" {
		t.Fatalf("explicit: got %q", got)
	}
	if got := Resolve("", "Красноярск"); got != "Asia/Krasnoyarsk" {
		t.Fatalf("city: got %q", got)
	}
	if got := Resolve("Not/AZone", "Красноярск"); got != "Asia/Krasnoyarsk" {
		t.Fatalf("invalid explicit falls to city: got %q", got)
	}
	if got := Resolve("", ""); got != Default {
		t.Fatalf("default: got %q", got)
	}
}

func TestValidIANA(t *testing.T) {
	if !Valid("Europe/Moscow") || !Valid("Asia/Krasnoyarsk") {
		t.Fatal("expected known zones valid")
	}
	if Valid("") || Valid("GMT+3") || Valid("Not/Real") {
		t.Fatal("expected invalid zones rejected")
	}
}

func TestServerLocalZoneDoesNotAffectUTCInstant(t *testing.T) {
	// Wall 16:00 in Moscow and Krasnoyarsk must yield different UTC instants
	// regardless of process local zone.
	msk := MustLoad("Europe/Moscow")
	krsk := MustLoad("Asia/Krasnoyarsk")
	day := time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC)
	mskInstant := time.Date(day.Year(), day.Month(), day.Day(), 16, 0, 0, 0, msk).UTC()
	krskInstant := time.Date(day.Year(), day.Month(), day.Day(), 16, 0, 0, 0, krsk).UTC()
	if mskInstant.Equal(krskInstant) {
		t.Fatal("16:00 Moscow and 16:00 Krasnoyarsk must be different UTC instants")
	}
	if mskInstant.Format(time.RFC3339) != "2026-06-15T13:00:00Z" {
		t.Fatalf("moscow utc: %s", mskInstant.Format(time.RFC3339))
	}
	if krskInstant.Format(time.RFC3339) != "2026-06-15T09:00:00Z" {
		t.Fatalf("krasnoyarsk utc: %s", krskInstant.Format(time.RFC3339))
	}
}

func TestLoadLocationIndependentOfProcessLocal(t *testing.T) {
	msk, err := time.LoadLocation("Europe/Moscow")
	if err != nil {
		t.Fatal(err)
	}
	krsk, err := time.LoadLocation("Asia/Krasnoyarsk")
	if err != nil {
		t.Fatal(err)
	}
	a := time.Date(2026, 6, 15, 16, 0, 0, 0, msk).UTC()
	b := time.Date(2026, 6, 15, 16, 0, 0, 0, krsk).UTC()
	if a.Equal(b) {
		t.Fatal("IANA zones must produce distinct UTC instants")
	}
}
