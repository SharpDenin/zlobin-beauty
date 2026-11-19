package domain

import "testing"

func TestNormalizeCuttingTechniques(t *testing.T) {
	got := NormalizeCuttingTechniques([]string{"  Фейд ", "фейд", "unknown", "Пойнт-кат"})
	if len(got) != 2 || got[0] != "Фейд" || got[1] != "Пойнт-кат" {
		t.Fatalf("unexpected: %#v", got)
	}
	if len(NormalizeCuttingTechniques(nil)) != 0 {
		t.Fatal("nil should yield empty")
	}
}
