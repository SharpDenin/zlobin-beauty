package service

import (
	"testing"

	"github.com/zlobin/zlobin-beauty/backend/shared/tz"
)

func TestBranchTimezoneFromKrasnoyarskCity(t *testing.T) {
	got := tz.Resolve("", "Красноярск")
	if got != "Asia/Krasnoyarsk" {
		t.Fatalf("got %q", got)
	}
}

func TestBranchTimezoneFromMoscowCity(t *testing.T) {
	got := tz.Resolve("", "Москва")
	if got != "Europe/Moscow" {
		t.Fatalf("got %q", got)
	}
}

func TestExplicitTimezoneWinsOverCity(t *testing.T) {
	got := tz.Resolve("Europe/Moscow", "Красноярск")
	if got != "Europe/Moscow" {
		t.Fatalf("got %q", got)
	}
}
