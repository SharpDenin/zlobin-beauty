package service

import (
	"math"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
)

func TestKnowledgeRankScoreProductBeatsCategory(t *testing.T) {
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	product := KnowledgeRankScore(KnowledgeRankInput{ExactProductMatch: true, Now: now})
	category := KnowledgeRankScore(KnowledgeRankInput{CategoryMatch: true, Now: now})
	if product <= category {
		t.Fatalf("product score %v should exceed category %v", product, category)
	}
}

func TestKnowledgeRankScoreAdditiveSignals(t *testing.T) {
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	got := KnowledgeRankScore(KnowledgeRankInput{
		ExactProductMatch: true,
		CategoryMatch:     true,
		BrandMatch:        true,
		TitleMatch:        true,
		Now:               now,
	})
	want := 100 + 50 + 30 + 80 + knowledgeRecencyScore(nil, time.Time{}, now)
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestKnowledgeRankScoreViewCountLog(t *testing.T) {
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	zero := KnowledgeRankScore(KnowledgeRankInput{ViewCount: 0, Now: now})
	ten := KnowledgeRankScore(KnowledgeRankInput{ViewCount: 10, Now: now})
	wantBoost := math.Log(1+10) * 5
	if math.Abs((ten-zero)-wantBoost) > 1e-9 {
		t.Fatalf("view boost got %v want %v", ten-zero, wantBoost)
	}
}

func TestKnowledgeRankScoreRecencyPrefersNewer(t *testing.T) {
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	freshAt := now.Add(-24 * time.Hour)
	oldAt := now.Add(-90 * 24 * time.Hour)
	fresh := KnowledgeRankScore(KnowledgeRankInput{PublishedAt: &freshAt, Now: now})
	old := KnowledgeRankScore(KnowledgeRankInput{PublishedAt: &oldAt, Now: now})
	if fresh <= old {
		t.Fatalf("fresh score %v should exceed old %v", fresh, old)
	}
}

func TestKnowledgeRankScoreDeterministic(t *testing.T) {
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	pub := now.Add(-48 * time.Hour)
	in := KnowledgeRankInput{
		ExactProductMatch: true,
		CategoryMatch:     true,
		BrandMatch:        false,
		TitleMatch:        true,
		ViewCount:         7,
		PublishedAt:       &pub,
		Now:               now,
	}
	a := KnowledgeRankScore(in)
	b := KnowledgeRankScore(in)
	if a != b {
		t.Fatalf("score not deterministic: %v vs %v", a, b)
	}
}

func TestKnowledgeRankScoreNegativeViewsIgnored(t *testing.T) {
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	neg := KnowledgeRankScore(KnowledgeRankInput{ViewCount: -5, Now: now})
	zero := KnowledgeRankScore(KnowledgeRankInput{ViewCount: 0, Now: now})
	if neg != zero {
		t.Fatalf("negative views should clamp to zero: %v vs %v", neg, zero)
	}
}

// Search is title-first: a title starting with the query beats a title that merely
// contains it, which beats a match found only in the brand.
func TestRankKnowledgeArticlesTitleFirst(t *testing.T) {
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	brandOnly := domain.KnowledgeArticle{ID: uuid.MustParse("00000000-0000-0000-0000-000000000001"), Title: "Инструкция к уходу", Brand: "Otium"}
	titleInfix := domain.KnowledgeArticle{ID: uuid.MustParse("00000000-0000-0000-0000-000000000002"), Title: "Быстрый Otium: инструкция", Brand: "Estel"}
	titlePrefix := domain.KnowledgeArticle{ID: uuid.MustParse("00000000-0000-0000-0000-000000000003"), Title: "Otium Aqua — гид", Brand: "Estel"}

	got := rankKnowledgeArticles(
		[]domain.KnowledgeArticle{brandOnly, titleInfix, titlePrefix},
		KnowledgeListQuery{Query: "OTIUM"},
		now,
	)
	want := []uuid.UUID{titlePrefix.ID, titleInfix.ID, brandOnly.ID}
	for i, a := range got {
		if a.ID != want[i] {
			t.Fatalf("position %d: got %s (%s), want %s", i, a.ID, a.Title, want[i])
		}
	}
}

func TestKnowledgeRankScoreTitlePrefixAddsOnTopOfTitleMatch(t *testing.T) {
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	title := KnowledgeRankScore(KnowledgeRankInput{TitleMatch: true, Now: now})
	prefix := KnowledgeRankScore(KnowledgeRankInput{TitleMatch: true, TitlePrefixMatch: true, Now: now})
	if math.Abs((prefix-title)-20) > 1e-9 {
		t.Fatalf("prefix bonus got %v want 20", prefix-title)
	}
}
