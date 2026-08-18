package domain

import "testing"

func TestResolveSchemeCategory(t *testing.T) {
	cases := map[string]string{
		"Окрашивание":        SchemeCategoryColoring,
		"Тонирование":        SchemeCategoryColoring,
		"Стрижка женская":    SchemeCategoryHaircut,
		"Уход Olaplex":       SchemeCategoryCare,
		"Маникюр":            SchemeCategoryGeneric,
	}
	for name, want := range cases {
		if got := ResolveSchemeCategory(name); got != want {
			t.Fatalf("%q: got %s want %s", name, got, want)
		}
	}
}
