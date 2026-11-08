package domain

import "testing"

func TestUniqueSpecializations(t *testing.T) {
	got := UniqueSpecializations([]string{"  Балаяж ", "балаяж", "Омбре", ""})
	if len(got) != 2 || got[0] != "Балаяж" || got[1] != "Омбре" {
		t.Fatalf("got %#v", got)
	}
}

func TestFilterSpecializationsForSlugs(t *testing.T) {
	got := FilterSpecializationsForSlugs(
		[]string{"Балаяж", "unknown", "Фейд"},
		[]string{"colorist", "barber"},
	)
	if len(got) != 2 || got[0] != "Балаяж" || got[1] != "Фейд" {
		t.Fatalf("got %#v", got)
	}
	if len(FilterSpecializationsForSlugs([]string{"x"}, nil)) != 0 {
		t.Fatal("empty slugs")
	}
}

func TestHasValidSpecialization(t *testing.T) {
	if HasValidSpecialization(nil) || HasValidSpecialization([]string{" ", ""}) {
		t.Fatal("empty")
	}
	if !HasValidSpecialization([]string{"Балаяж"}) {
		t.Fatal("expected valid")
	}
}
