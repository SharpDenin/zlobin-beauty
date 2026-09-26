package service

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
)

func TestUniqueUUIDs(t *testing.T) {
	a := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	b := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	got := UniqueUUIDs([]uuid.UUID{a, uuid.Nil, a, b})
	if len(got) != 2 || got[0] != a || got[1] != b {
		t.Fatalf("got %v", got)
	}
}

func TestEmptyRecommendationReason(t *testing.T) {
	if EmptyRecommendationReason(true, false, false) != EmptyReasonProduct {
		t.Fatal("product empty")
	}
	if EmptyRecommendationReason(false, true, false) != EmptyReasonService {
		t.Fatal("service empty")
	}
	if EmptyRecommendationReason(false, false, true) != EmptyReasonGeneric {
		t.Fatal("generic empty")
	}
}

func TestRecommendationContext(t *testing.T) {
	pid := uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	sidProd := uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
	article := domain.KnowledgeArticle{Title: "Majirel протокол", Category: "Колористика", Brand: "L'Oreal", ProductIDs: []uuid.UUID{pid}}
	if RecommendationContext(article, []uuid.UUID{pid}, nil, "") != RecommendationContextProduct {
		t.Fatal("product context")
	}
	serviceOnly := domain.KnowledgeArticle{Title: "Уход", ProductIDs: []uuid.UUID{sidProd}}
	if RecommendationContext(serviceOnly, nil, []uuid.UUID{sidProd}, "") != RecommendationContextService {
		t.Fatal("service context")
	}
	search := domain.KnowledgeArticle{Title: "Балаяж на Koleston", Category: "Колористика"}
	if RecommendationContext(search, nil, nil, "балаяж") != RecommendationContextSearch {
		t.Fatal("search context")
	}
	if RecommendationContext(domain.KnowledgeArticle{Title: "Other"}, nil, nil, "") != RecommendationContextRelated {
		t.Fatal("related fallback")
	}
}

func TestRecommendationDoesNotInventChemistry(t *testing.T) {
	missing := uuid.MustParse("cccccccc-cccc-cccc-cccc-cccccccccccc")
	article := domain.KnowledgeArticle{Title: "Olaplex уход", ProductIDs: []uuid.UUID{uuid.MustParse("dddddddd-dddd-dddd-dddd-dddddddddddd")}}
	if RecommendationContext(article, []uuid.UUID{missing}, nil, "") == RecommendationContextProduct {
		t.Fatal("unrelated article must not be claimed as product alternative")
	}
}

func TestEmptyReasonDoesNotClaimStoredAlternative(t *testing.T) {
	msg := EmptyRecommendationReason(true, false, false)
	if strings.Contains(strings.ToLower(msg), "замен") && !strings.Contains(msg, "нет сохранённой") {
		t.Fatalf("must not invent a substitute: %s", msg)
	}
	if msg != EmptyReasonProduct {
		t.Fatalf("got %s", msg)
	}
}
