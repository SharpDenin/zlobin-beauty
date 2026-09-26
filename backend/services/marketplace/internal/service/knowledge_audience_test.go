package service

import (
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
)

func TestClassifyArticleAudience(t *testing.T) {
	homeID := uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	proID := uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
	unknownID := uuid.MustParse("cccccccc-cccc-cccc-cccc-cccccccccccc")
	audiences := map[uuid.UUID]string{
		homeID: "all",
		proID:  "professional_only",
	}

	home := ClassifyArticleAudience([]uuid.UUID{homeID}, audiences)
	if !home.HomeCare || home.Kind != AudienceKindHome || !ClientEligibleArticle(home) {
		t.Fatalf("home article: %+v", home)
	}

	pro := ClassifyArticleAudience([]uuid.UUID{proID}, audiences)
	if pro.HomeCare || !pro.Professional || ClientEligibleArticle(pro) || pro.Kind != AudienceKindProfessional {
		t.Fatalf("professional article: %+v", pro)
	}

	mixed := ClassifyArticleAudience([]uuid.UUID{homeID, proID}, audiences)
	if !mixed.HomeCare || !mixed.Professional || mixed.Kind != AudienceKindMixed || !ClientEligibleArticle(mixed) {
		t.Fatalf("mixed article: %+v", mixed)
	}

	none := ClassifyArticleAudience(nil, audiences)
	if none.HomeCare || ClientEligibleArticle(none) || none.Kind != AudienceKindProfessional {
		t.Fatalf("unlinked article must not be client-eligible: %+v", none)
	}

	categoryOnly := ClassifyArticleAudience([]uuid.UUID{}, audiences)
	if categoryOnly.HomeCare {
		t.Fatal("category-only article must not be treated as home-care")
	}

	unknown := ClassifyArticleAudience([]uuid.UUID{unknownID}, audiences)
	if unknown.HomeCare {
		t.Fatal("unknown product must not count as home-care")
	}
}

func TestAudienceMutationChangesEligibility(t *testing.T) {
	pid := uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	audiences := map[uuid.UUID]string{pid: "all"}
	if !ClientEligibleArticle(ClassifyArticleAudience([]uuid.UUID{pid}, audiences)) {
		t.Fatal("all must be client eligible")
	}
	audiences[pid] = "professional_only"
	if ClientEligibleArticle(ClassifyArticleAudience([]uuid.UUID{pid}, audiences)) {
		t.Fatal("professional_only must hide article from client")
	}
	audiences[pid] = "all"
	if !ClientEligibleArticle(ClassifyArticleAudience([]uuid.UUID{pid}, audiences)) {
		t.Fatal("flipping back to all must restore client eligibility without editing the article")
	}
}

func TestFilterHomeCareAndPaginateAfterFilter(t *testing.T) {
	home := uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	pro := uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
	audiences := map[uuid.UUID]string{home: "all", pro: "professional_only"}
	items := []domain.KnowledgeArticle{
		{Title: "pro-1", ProductIDs: []uuid.UUID{pro}},
		{Title: "home-1", ProductIDs: []uuid.UUID{home}},
		{Title: "pro-2", ProductIDs: []uuid.UUID{pro}},
		{Title: "home-2", ProductIDs: []uuid.UUID{home}},
		{Title: "unlinked"},
		{Title: "mixed", ProductIDs: []uuid.UUID{home, pro}},
	}
	for i := range items {
		applyClassification(&items[i], audiences)
	}
	filtered := FilterHomeCareArticles(items)
	if len(filtered) != 3 {
		t.Fatalf("expected 3 home-care articles, got %d", len(filtered))
	}
	page := paginateArticles(filtered, 0, 2)
	if len(page) != 2 || page[0].Title != "home-1" || page[1].Title != "home-2" {
		t.Fatalf("page after filter: %+v", titles(page))
	}
	page2 := paginateArticles(filtered, 2, 2)
	if len(page2) != 1 || page2[0].Title != "mixed" {
		t.Fatalf("second page must not include hidden professional articles: %+v", titles(page2))
	}
}

func TestStripProfessionalProductIDs(t *testing.T) {
	home := uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	pro := uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
	a := domain.KnowledgeArticle{ProductIDs: []uuid.UUID{home, pro}, ProductID: &pro}
	StripProfessionalProductIDs(&a, map[uuid.UUID]string{home: "all", pro: "professional_only"})
	if len(a.ProductIDs) != 1 || a.ProductIDs[0] != home {
		t.Fatalf("client payload must hide professional products: %v", a.ProductIDs)
	}
	if a.ProductID == nil || *a.ProductID != home {
		t.Fatal("legacy product_id must not leak a professional product")
	}
}

func TestClientSearchCannotSurfaceProfessionalArticle(t *testing.T) {
	home := uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	pro := uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
	q := KnowledgeListQuery{Query: "окрашивание"}
	match := domain.KnowledgeArticle{
		Title: "Техника окрашивания", ProductIDs: []uuid.UUID{pro},
	}
	homeHit := domain.KnowledgeArticle{
		Title: "Домашний уход после окрашивания", ProductIDs: []uuid.UUID{home},
	}
	applyClassification(&match, map[uuid.UUID]string{pro: "professional_only"})
	applyClassification(&homeHit, map[uuid.UUID]string{home: "all"})
	if !ArticleMatchesListQuery(match, q) {
		t.Fatal("professional article still matches the search query before audience filter")
	}
	visible := FilterHomeCareArticles([]domain.KnowledgeArticle{match, homeHit})
	if len(visible) != 1 || visible[0].Title != homeHit.Title {
		t.Fatalf("client search must drop professional article: %+v", titles(visible))
	}
}

func TestMixedArticleClientPayloadIsHomeOnly(t *testing.T) {
	home := uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	pro := uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
	a := domain.KnowledgeArticle{ProductIDs: []uuid.UUID{home, pro}}
	audiences := map[uuid.UUID]string{home: "all", pro: "professional_only"}
	applyClassification(&a, audiences)
	if a.AudienceKind != AudienceKindMixed {
		t.Fatalf("mixed kind: %s", a.AudienceKind)
	}
	StripProfessionalProductIDs(&a, audiences)
	applyClassification(&a, audiences)
	if !a.HomeCare || a.Professional || a.AudienceKind != AudienceKindHome {
		t.Fatalf("after client strip mixed must look like home-care: %+v", a)
	}
}

func titles(items []domain.KnowledgeArticle) []string {
	out := make([]string, len(items))
	for i, a := range items {
		out[i] = a.Title
	}
	return out
}
