package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func TestParseServiceIDList(t *testing.T) {
	a := uuid.MustParse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
	b := uuid.MustParse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
	got := parseServiceIDList([]any{a.String(), "not-a-uuid", b.String(), a.String(), 12})
	if len(got) != 2 || got[0] != a || got[1] != b {
		t.Fatalf("got %#v", got)
	}
	if parseServiceIDList(nil) != nil {
		t.Fatal("nil input")
	}
	if parseServiceIDList("x") != nil {
		t.Fatal("non-array")
	}
}

func TestNormalizePlanPricesEmptyAndSpoof(t *testing.T) {
	s := &Service{}
	out, err := s.normalizePlanPrices(context.Background(), json.RawMessage(`{"desired_result":"x","price_total_minor":99999}`))
	if err != nil {
		t.Fatal(err)
	}
	var plan map[string]any
	if err := json.Unmarshal(out, &plan); err != nil {
		t.Fatal(err)
	}
	if plan["price_total_minor"].(float64) != 0 {
		t.Fatalf("expected zero total without services, got %v", plan["price_total_minor"])
	}
	ids, _ := plan["selected_service_ids"].([]any)
	if len(ids) != 0 {
		t.Fatalf("expected empty ids, got %#v", ids)
	}
}

func TestNormalizePlanPricesFromCatalog(t *testing.T) {
	svcA := uuid.MustParse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
	svcB := uuid.MustParse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/services/"+svcA.String(), func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"price_minor": 150000})
	})
	mux.HandleFunc("GET /v1/services/"+svcB.String(), func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"price_minor": 250000})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	s := &Service{marketplaceURL: srv.URL, httpClient: srv.Client()}
	raw := json.RawMessage(`{
		"desired_result":"blond",
		"selected_service_ids":["` + svcA.String() + `","` + svcB.String() + `"],
		"price_total_minor":1
	}`)
	out, err := s.normalizePlanPrices(context.Background(), raw)
	if err != nil {
		t.Fatal(err)
	}
	var plan map[string]any
	if err := json.Unmarshal(out, &plan); err != nil {
		t.Fatal(err)
	}
	if plan["price_total_minor"].(float64) != 400000 {
		t.Fatalf("expected catalog sum 400000, got %v", plan["price_total_minor"])
	}
}
