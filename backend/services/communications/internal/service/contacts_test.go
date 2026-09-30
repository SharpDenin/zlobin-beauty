package service

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestClampContactPagination(t *testing.T) {
	l, o := ClampContactPagination(0, -5)
	if l != 50 || o != 0 {
		t.Fatalf("defaults: %d %d", l, o)
	}
	l, o = ClampContactPagination(200, 3)
	if l != 50 || o != 3 {
		t.Fatalf("clamp limit: %d %d", l, o)
	}
	l, o = ClampContactPagination(10, 2)
	if l != 10 || o != 2 {
		t.Fatalf("keep: %d %d", l, o)
	}
}

func TestNormalizeContactNote(t *testing.T) {
	got, err := NormalizeContactNote("  hello  ")
	if err != nil || got != "hello" {
		t.Fatalf("trim: %q %v", got, err)
	}
	long := strings.Repeat("а", domain.MaxContactNoteRunes+1)
	err = mustNoteErr(t, long)
	if err == nil {
		t.Fatal("overlong note must fail")
	}
	ae, ok := apperr.As(err)
	if !ok || ae.HTTPStatus != 400 {
		t.Fatalf("expected validation, got %v", err)
	}
}

func mustNoteErr(t *testing.T, note string) error {
	t.Helper()
	_, err := NormalizeContactNote(note)
	return err
}

func TestNormalizeContactNoteModeration(t *testing.T) {
	if _, err := NormalizeContactNote("normal note"); err != nil {
		t.Fatalf("clean note: %v", err)
	}
	_, err := NormalizeContactNote("полный идиот")
	ae, ok := apperr.As(err)
	if !ok || ae.Code != apperr.CodeContentNotAllowed {
		t.Fatalf("expected content_not_allowed, got %v", err)
	}
}

func TestValidateContactSearchQuery(t *testing.T) {
	if err := ValidateContactSearchQuery("a"); err == nil {
		t.Fatal("min length")
	}
	if err := ValidateContactSearchQuery("  "); err == nil {
		t.Fatal("whitespace")
	}
	if err := ValidateContactSearchQuery("ан"); err != nil {
		t.Fatal(err)
	}
	if utf8.RuneCountInString("ан") != 2 {
		t.Fatal("sanity")
	}
}

func TestFilterContactSearchHits(t *testing.T) {
	actor := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	peer := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	other := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	added := map[uuid.UUID]struct{}{peer: {}}
	hits := []identityPublicUser{
		{ID: actor, DisplayName: "Me", Roles: []string{"client"}},
		{ID: peer, DisplayName: "Peer", Roles: []string{"master"}, City: "Москва"},
		{ID: other, DisplayName: "Other", Roles: []string{"client"}},
	}
	out := FilterContactSearchHits(actor, added, hits)
	if len(out) != 2 {
		t.Fatalf("len=%d", len(out))
	}
	if out[0].ID != peer || !out[0].AlreadyAdded {
		t.Fatalf("peer flags: %+v", out[0])
	}
	if out[1].AlreadyAdded {
		t.Fatal("other must not be already added")
	}
}

func TestFilterContactSearchHitsCapsTen(t *testing.T) {
	actor := uuid.New()
	hits := make([]identityPublicUser, 0, 15)
	for i := 0; i < 15; i++ {
		hits = append(hits, identityPublicUser{ID: uuid.New(), DisplayName: "U", Roles: []string{"client"}})
	}
	out := FilterContactSearchHits(actor, nil, hits)
	if len(out) != 10 {
		t.Fatalf("want 10 got %d", len(out))
	}
}

func TestMatchContactFilters(t *testing.T) {
	v := domain.ContactView{
		DisplayName: "Анна Волкова", City: "Красноярск", Note: "колорист",
		Roles: []string{"master", "client"},
	}
	if !matchContactFilters(v, "анна", "") {
		t.Fatal("name")
	}
	if !matchContactFilters(v, "красно", "") {
		t.Fatal("city")
	}
	if matchContactFilters(v, "", "supplier") {
		t.Fatal("role miss")
	}
	if !matchContactFilters(v, "", "master") {
		t.Fatal("role hit")
	}
}

func TestContactSelfErrorCode(t *testing.T) {
	err := apperr.Unprocessable(apperr.CodeContactSelf, "cannot add yourself as a contact")
	ae, ok := apperr.As(err)
	if !ok || ae.Code != apperr.CodeContactSelf || ae.HTTPStatus != 422 {
		t.Fatalf("got %+v", ae)
	}
}
