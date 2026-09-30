package service

import (
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
)

func TestArticleMatchesListQueryCombination(t *testing.T) {
	org := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	otherOrg := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	p1 := uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	p2 := uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
	c1 := uuid.MustParse("cccccccc-cccc-cccc-cccc-cccccccccccc")
	c2 := uuid.MustParse("dddddddd-dddd-dddd-dddd-dddddddddddd")

	match := domain.KnowledgeArticle{
		Title: "A", Brand: "B1", Category: "Окрашивание",
		AuthorOrgID: &org, ProductIDs: []uuid.UUID{p1}, CategoryIDs: []uuid.UUID{c1},
	}
	subsetBrand := match
	subsetBrand.Brand = "Other"
	subsetProduct := match
	subsetProduct.ProductIDs = []uuid.UUID{p2}
	subsetCat := match
	subsetCat.CategoryIDs = []uuid.UUID{c2}
	subsetSupplier := match
	subsetSupplier.AuthorOrgID = &otherOrg

	q := KnowledgeListQuery{
		Brands:             []string{"B1"},
		Categories:         []string{"Окрашивание"},
		SupplierOrgIDs:     []uuid.UUID{org},
		ProductIDs:         []uuid.UUID{p1},
		ProductCategoryIDs: []uuid.UUID{c1},
	}
	if !ArticleMatchesListQuery(match, q) {
		t.Fatal("article A must match combined filters")
	}
	for i, a := range []domain.KnowledgeArticle{subsetBrand, subsetProduct, subsetCat, subsetSupplier} {
		if ArticleMatchesListQuery(a, q) {
			t.Fatalf("subset article %d must not match combined filters", i)
		}
	}
}

func TestCategoryMatchesFilterPrefix(t *testing.T) {
	if !categoryMatchesFilter("Окрашивание и осветление / Окрашивание / Крем краска", "Окрашивание и осветление") {
		t.Fatal("parent path must include children")
	}
	if !categoryMatchesFilter("Уход", "уход") {
		t.Fatal("exact category is case-insensitive")
	}
	if categoryMatchesFilter("Уход за волосами / Для блонда", "Уход") {
		t.Fatal("a shorter word must not match a different branch")
	}
}

func TestEstimateReadingMinutesFromDocJSON(t *testing.T) {
	doc := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"один два три"}]}]}`
	if n := EstimateReadingMinutes(doc, "doc_json"); n < 1 {
		t.Fatalf("minutes=%d", n)
	}
}
