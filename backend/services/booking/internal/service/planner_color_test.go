package service

import "testing"

func TestNormalizePlannerColorTokens(t *testing.T) {
	got, err := NormalizePlannerColor("success", "task")
	if err != nil || got != "success" {
		t.Fatalf("token: got %q err=%v", got, err)
	}
	got, err = NormalizePlannerColor("", "break")
	if err != nil || got != "info" {
		t.Fatalf("category default: got %q err=%v", got, err)
	}
	got, err = NormalizePlannerColor("#7C82FF", "task")
	if err != nil || got != "#7c82ff" {
		t.Fatalf("hex: got %q err=%v", got, err)
	}
	got, err = NormalizePlannerColor("var(--color-warning)", "task")
	if err != nil || got != "warning" {
		t.Fatalf("css var: got %q err=%v", got, err)
	}
	if _, err := NormalizePlannerColor("not-a-color", "task"); err == nil {
		t.Fatal("expected validation error")
	}
	if colorOrDefault("") != "primary" {
		t.Fatal("empty default")
	}
	if colorOrDefault("#b45a6a") != "#b45a6a" {
		t.Fatal("legacy hex must stay")
	}
}
