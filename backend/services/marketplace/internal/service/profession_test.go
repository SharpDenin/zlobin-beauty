package service

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func codeOf(err error) apperr.Code {
	ae, ok := apperr.As(err)
	if !ok {
		return ""
	}
	return ae.Code
}

func TestPlanProfessionTypesCreateRequiresAtLeastOne(t *testing.T) {
	_, err := planProfessionTypes(nil, nil, nil, true, false)
	if codeOf(err) != apperr.CodeProfessionTypesRequired {
		t.Fatalf("expected profession_types_required, got %v", err)
	}
}

func TestPlanProfessionTypesAllowsMultiple(t *testing.T) {
	a := uuid.MustParse("11111111-1111-4111-8111-111111111001")
	b := uuid.MustParse("11111111-1111-4111-8111-111111111002")
	catalog := []domain.ProfessionType{
		{ID: a, Slug: "colorist", Name: "Колорист", IsActive: true},
		{ID: b, Slug: "hairdresser", Name: "Парикмахер", IsActive: true},
	}
	plan, err := planProfessionTypes(nil, []uuid.UUID{a, b}, catalog, true, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.KeepIDs) != 2 {
		t.Fatalf("want 2 ids, got %d", len(plan.KeepIDs))
	}
}

func TestPlanProfessionTypesCanAddUnlocked(t *testing.T) {
	a := uuid.MustParse("11111111-1111-4111-8111-111111111001")
	b := uuid.MustParse("11111111-1111-4111-8111-111111111002")
	catalog := []domain.ProfessionType{
		{ID: a, IsActive: true},
		{ID: b, IsActive: true},
	}
	existing := []assignedProfessionType{{ID: a}}
	plan, err := planProfessionTypes(existing, []uuid.UUID{a, b}, catalog, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.KeepIDs) != 2 {
		t.Fatalf("want add to succeed, got %#v", plan.KeepIDs)
	}
}

func TestPlanProfessionTypesRejectsRemovingLocked(t *testing.T) {
	a := uuid.MustParse("11111111-1111-4111-8111-111111111001")
	b := uuid.MustParse("11111111-1111-4111-8111-111111111002")
	now := time.Now()
	catalog := []domain.ProfessionType{
		{ID: a, IsActive: true},
		{ID: b, IsActive: true},
	}
	existing := []assignedProfessionType{{ID: a, LockedAt: &now}, {ID: b}}
	_, err := planProfessionTypes(existing, []uuid.UUID{b}, catalog, false, false)
	if codeOf(err) != apperr.CodeProfessionTypeLocked {
		t.Fatalf("expected profession_type_locked, got %v", err)
	}
}

func TestPlanProfessionTypesForceLockTreatsExistingAsLocked(t *testing.T) {
	a := uuid.MustParse("11111111-1111-4111-8111-111111111001")
	b := uuid.MustParse("11111111-1111-4111-8111-111111111002")
	catalog := []domain.ProfessionType{{ID: a, IsActive: true}, {ID: b, IsActive: true}}
	existing := []assignedProfessionType{{ID: a}}
	_, err := planProfessionTypes(existing, []uuid.UUID{b}, catalog, false, true)
	if codeOf(err) != apperr.CodeProfessionTypeLocked {
		t.Fatalf("expected locked when published/in-use, got %v", err)
	}
}

func TestPlanProfessionTypesRejectsUnknown(t *testing.T) {
	missing := uuid.MustParse("11111111-1111-4111-8111-111111111099")
	_, err := planProfessionTypes(nil, []uuid.UUID{missing}, nil, true, false)
	if codeOf(err) != apperr.CodeValidation {
		t.Fatalf("expected validation_error, got %v", err)
	}
}

func TestPlanProfessionTypesRejectsInactive(t *testing.T) {
	a := uuid.MustParse("11111111-1111-4111-8111-111111111001")
	catalog := []domain.ProfessionType{{ID: a, IsActive: false}}
	_, err := planProfessionTypes(nil, []uuid.UUID{a}, catalog, true, false)
	if codeOf(err) != apperr.CodeValidation {
		t.Fatalf("expected validation_error for inactive, got %v", err)
	}
}

func TestPlanProfessionTypesDoesNotChangeWorkTypeSemantics(t *testing.T) {
	// Guard: profession type planner never inspects work_type.
	a := uuid.MustParse("11111111-1111-4111-8111-111111111002")
	catalog := []domain.ProfessionType{{ID: a, IsActive: true}}
	plan, err := planProfessionTypes(nil, []uuid.UUID{a}, catalog, true, false)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Lock {
		t.Fatal("create of unpublished unused profile should not force-lock")
	}
}
