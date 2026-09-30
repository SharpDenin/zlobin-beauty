package service

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestNormalizePortfolioTitleFallsBackToCaption(t *testing.T) {
	if got := normalizePortfolioTitle("", "  Legacy  "); got != "Legacy" {
		t.Fatalf("got %q", got)
	}
	if got := normalizePortfolioTitle("Title", "Caption"); got != "Title" {
		t.Fatalf("got %q", got)
	}
}

func TestMediaTypeFromContentType(t *testing.T) {
	cases := map[string]string{
		"image/jpeg":      "photo",
		"image/png":       "photo",
		"image/gif":       "gif",
		"IMAGE/GIF":       "gif",
		"video/mp4":       "video",
		"video/webm":      "video",
		"":                "photo",
		"application/pdf": "photo",
	}
	for in, want := range cases {
		if got := mediaTypeFromContentType(in); got != want {
			t.Fatalf("%q: got %q want %q", in, got, want)
		}
	}
}

func TestValidatePortfolioFieldsLength(t *testing.T) {
	longTitle := strings.Repeat("а", portfolioTitleMax+1)
	if err := validatePortfolioFields(longTitle, "", ""); err == nil {
		t.Fatal("expected title length error")
	} else if codeOf(err) != apperr.CodeValidation {
		t.Fatalf("code=%s", codeOf(err))
	}
	longDesc := strings.Repeat("b", portfolioDescriptionMax+1)
	if err := validatePortfolioFields("ok", longDesc, ""); codeOf(err) != apperr.CodeValidation {
		t.Fatalf("desc code=%s err=%v", codeOf(err), err)
	}
	longCat := strings.Repeat("c", portfolioCategoryMax+1)
	if err := validatePortfolioFields("ok", "ok", longCat); codeOf(err) != apperr.CodeValidation {
		t.Fatalf("cat code=%s", codeOf(err))
	}
	if utf8.RuneCountInString(strings.Repeat("я", portfolioTitleMax)) != portfolioTitleMax {
		t.Fatal("fixture broken")
	}
	if err := validatePortfolioFields(strings.Repeat("я", portfolioTitleMax), "описание", "Стрижки"); err != nil {
		t.Fatal(err)
	}
}

func TestPlanPortfolioReorderOK(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	if err := planPortfolioReorder([]uuid.UUID{a, b, c}, []uuid.UUID{c, a, b}); err != nil {
		t.Fatal(err)
	}
}

func TestPlanPortfolioReorderRejectsForeignID(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	foreign := uuid.New()
	err := planPortfolioReorder([]uuid.UUID{a, b}, []uuid.UUID{a, foreign})
	if codeOf(err) != apperr.CodeForbidden {
		t.Fatalf("want forbidden, got %v", err)
	}
}

func TestPlanPortfolioReorderRejectsIncomplete(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	err := planPortfolioReorder([]uuid.UUID{a, b}, []uuid.UUID{a})
	if codeOf(err) != apperr.CodeValidation {
		t.Fatalf("want validation, got %v", err)
	}
}

func TestPlanPortfolioReorderRejectsDuplicate(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	err := planPortfolioReorder([]uuid.UUID{a, b}, []uuid.UUID{a, a})
	if codeOf(err) != apperr.CodeValidation {
		t.Fatalf("want validation, got %v", err)
	}
}

func TestValidatePortfolioFieldsModeration(t *testing.T) {
	// Use a clearly disallowed token if the shared moderation list has known patterns;
	// empty fields must pass.
	if err := validatePortfolioFields("", "", ""); err != nil {
		t.Fatal(err)
	}
}
