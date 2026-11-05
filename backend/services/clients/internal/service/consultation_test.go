package service

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestValidateQuestionnaireForSubmit(t *testing.T) {
	if err := validateQuestionnaireForSubmit(json.RawMessage(`{}`)); err == nil {
		t.Fatal("expected validation error")
	}
	if err := validateQuestionnaireForSubmit(json.RawMessage(`{"desired_result":"blond"}`)); err == nil {
		t.Fatal("expected hair_type required")
	}
	if err := validateQuestionnaireForSubmit(json.RawMessage(`{"desired_result":"blond","hair_type":"natural"}`)); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func TestValidatePlanForSend(t *testing.T) {
	if err := validatePlanForSend(json.RawMessage(`{}`)); err == nil {
		t.Fatal("expected error")
	}
	ok := `{"desired_result":"ash","technique":"balayage","formula":"7N + 6V 1:1 ox 20"}`
	if err := validatePlanForSend(json.RawMessage(ok)); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func TestVersionImmutable(t *testing.T) {
	now := time.Now().UTC()
	if domain.VersionImmutable(&domain.HairConsultationVersion{Status: domain.VerDraft}) {
		t.Fatal("draft mutable")
	}
	if !domain.VersionImmutable(&domain.HairConsultationVersion{Status: domain.VerApproved}) {
		t.Fatal("approved immutable")
	}
	if !domain.VersionImmutable(&domain.HairConsultationVersion{Status: domain.VerSent, ImmutableAt: &now}) {
		t.Fatal("immutable_at locks")
	}
	if !domain.VersionImmutable(&domain.HairConsultationVersion{Status: domain.VerSuperseded}) {
		t.Fatal("superseded immutable")
	}
}

func TestValidMediaSlots(t *testing.T) {
	for _, s := range []string{"overview", "roots", "length", "ends", "strand_a4", "reference"} {
		if !domain.ValidMediaSlot(s) {
			t.Fatalf("slot %s should be valid", s)
		}
	}
	if domain.ValidMediaSlot("selfie") {
		t.Fatal("unexpected slot")
	}
}

func TestNormalizeJSON(t *testing.T) {
	if string(normalizeJSON(nil)) != `{}` {
		t.Fatal("nil")
	}
	if string(normalizeJSON(json.RawMessage(`null`))) != `{}` {
		t.Fatal("null")
	}
	out := normalizeJSON(json.RawMessage(`{"a":1}`))
	var m map[string]any
	if err := json.Unmarshal(out, &m); err != nil || m["a"].(float64) != 1 {
		t.Fatalf("got %s", out)
	}
}

func TestACLHelpers(t *testing.T) {
	s := &Service{}
	client := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	master := uuid.MustParse("22222222-2222-4222-8222-222222222222")
	other := uuid.MustParse("33333333-3333-4333-8333-333333333333")
	c := &domain.HairConsultation{ClientUserID: client, MasterUserID: master}
	if err := s.requireClient(c, client); err != nil {
		t.Fatal(err)
	}
	if err := s.requireClient(c, master); err == nil {
		t.Fatal("master must not act as client")
	}
	if err := s.requireMaster(c, master); err != nil {
		t.Fatal(err)
	}
	if err := s.requireMaster(c, client); err == nil {
		t.Fatal("client must not act as master")
	}
	err := s.requireMaster(c, other)
	if ae, ok := apperr.As(err); !ok || ae.Code != apperr.CodeForbidden {
		t.Fatalf("expected forbidden, got %v", err)
	}
}

func TestHasSlot(t *testing.T) {
	media := []domain.HairConsultationMedia{{Slot: domain.SlotRoots}, {Slot: domain.SlotOverview}}
	if !hasSlot(media, domain.SlotOverview) {
		t.Fatal("expected overview")
	}
	if hasSlot(media, domain.SlotStrandA4) {
		t.Fatal("unexpected strand")
	}
}
