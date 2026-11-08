package service

import (
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestResolveSpecializationsCatalog(t *testing.T) {
	out, err := resolveSpecializations(
		[]string{"Балаяж", "  балаяж ", "Фейд"},
		[]string{"colorist", "barber"},
		nil,
		true,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 2 || out[0] != "Балаяж" || out[1] != "Фейд" {
		t.Fatalf("got %#v", out)
	}
}

func TestResolveSpecializationsRejectsUnknownOnTypeChange(t *testing.T) {
	existing := &domain.MasterProfile{Specializations: []string{"колористика"}}
	_, err := resolveSpecializations([]string{"колористика"}, []string{"colorist"}, existing, true)
	if err == nil {
		t.Fatal("expected validation error")
	}
	if ae, ok := apperr.As(err); !ok || ae.Code != apperr.CodeValidation {
		t.Fatalf("want validation, got %v", err)
	}
}

func TestResolveSpecializationsGrandfathersLegacy(t *testing.T) {
	existing := &domain.MasterProfile{Specializations: []string{"колористика"}}
	out, err := resolveSpecializations([]string{"колористика"}, []string{"colorist"}, existing, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 || out[0] != "колористика" {
		t.Fatalf("got %#v", out)
	}
}

func TestSameProfessionTypeIDs(t *testing.T) {
	a := uuid.MustParse("11111111-1111-4111-8111-111111111001")
	b := uuid.MustParse("11111111-1111-4111-8111-111111111002")
	existing := []domain.ProfessionType{{ID: a}, {ID: b}}
	if !sameProfessionTypeIDs(existing, []uuid.UUID{b, a}) {
		t.Fatal("order independent")
	}
	if sameProfessionTypeIDs(existing, []uuid.UUID{a}) {
		t.Fatal("different set")
	}
}
