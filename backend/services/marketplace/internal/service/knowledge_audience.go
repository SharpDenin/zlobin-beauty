package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

const (
	productAudienceAll              = "all"
	productAudienceProfessionalOnly = "professional_only"

	AudienceKindHome         = "home"
	AudienceKindProfessional = "professional"
	AudienceKindMixed        = "mixed"
)

type ArticleAudience struct {
	HomeCare     bool
	Professional bool
	Kind         string
}

func ClassifyArticleAudience(productIDs []uuid.UUID, audienceByProduct map[uuid.UUID]string) ArticleAudience {
	home, proProduct := false, false
	for _, id := range productIDs {
		switch strings.ToLower(strings.TrimSpace(audienceByProduct[id])) {
		case productAudienceProfessionalOnly:
			proProduct = true
		case productAudienceAll:
			home = true
		}
	}
	kind := AudienceKindProfessional
	if home && proProduct {
		kind = AudienceKindMixed
	} else if home {
		kind = AudienceKindHome
	}
	return ArticleAudience{
		HomeCare:     home,
		Professional: proProduct || !home,
		Kind:         kind,
	}
}

func ClientEligibleArticle(a ArticleAudience) bool {
	return a.HomeCare
}

func FilterHomeCareArticles(items []domain.KnowledgeArticle) []domain.KnowledgeArticle {
	out := make([]domain.KnowledgeArticle, 0, len(items))
	for _, it := range items {
		if it.HomeCare {
			out = append(out, it)
		}
	}
	return out
}

func StripProfessionalProductIDs(a *domain.KnowledgeArticle, audienceByProduct map[uuid.UUID]string) {
	if a == nil {
		return
	}
	kept := make([]uuid.UUID, 0, len(a.ProductIDs))
	for _, id := range a.ProductIDs {
		if strings.EqualFold(strings.TrimSpace(audienceByProduct[id]), productAudienceAll) {
			kept = append(kept, id)
		}
	}
	a.ProductIDs = kept
	if a.ProductID == nil {
		if len(kept) > 0 {
			id := kept[0]
			a.ProductID = &id
		}
		return
	}
	for _, id := range kept {
		if id == *a.ProductID {
			return
		}
	}
	if len(kept) > 0 {
		id := kept[0]
		a.ProductID = &id
		return
	}
	a.ProductID = nil
}

func paginateArticles(items []domain.KnowledgeArticle, offset, limit int) []domain.KnowledgeArticle {
	if offset < 0 {
		offset = 0
	}
	if offset >= len(items) {
		return []domain.KnowledgeArticle{}
	}
	end := offset + limit
	if end > len(items) {
		end = len(items)
	}
	return items[offset:end]
}

func applyClassification(a *domain.KnowledgeArticle, audienceByProduct map[uuid.UUID]string) {
	c := ClassifyArticleAudience(a.ProductIDs, audienceByProduct)
	a.HomeCare = c.HomeCare
	a.Professional = c.Professional
	a.AudienceKind = c.Kind
}

func collectArticleProductIDs(items []domain.KnowledgeArticle) []uuid.UUID {
	ids := make([]uuid.UUID, 0)
	for _, a := range items {
		ids = append(ids, a.ProductIDs...)
		if a.ProductID != nil {
			ids = append(ids, *a.ProductID)
		}
	}
	return UniqueUUIDs(ids)
}

func (s *Service) applyArticleAudience(ctx context.Context, items []domain.KnowledgeArticle, homeCareOnly bool) ([]domain.KnowledgeArticle, error) {
	if items == nil {
		items = []domain.KnowledgeArticle{}
	}
	audiences, err := s.fetchProductAudiences(ctx, collectArticleProductIDs(items))
	if err != nil {
		return nil, err
	}
	for i := range items {
		applyClassification(&items[i], audiences)
	}
	if homeCareOnly {
		items = FilterHomeCareArticles(items)
		for i := range items {
			StripProfessionalProductIDs(&items[i], audiences)
			applyClassification(&items[i], audiences)
		}
	}
	return items, nil
}

func (s *Service) classifyOneArticle(ctx context.Context, a *domain.KnowledgeArticle, stripProfessional bool) error {
	if a == nil {
		return nil
	}
	items, err := s.applyArticleAudience(ctx, []domain.KnowledgeArticle{*a}, stripProfessional)
	if err != nil {
		return err
	}
	if len(items) == 0 {
		applyClassification(a, map[uuid.UUID]string{})
		if stripProfessional {
			StripProfessionalProductIDs(a, map[uuid.UUID]string{})
		}
		return nil
	}
	*a = items[0]
	return nil
}

func (s *Service) fetchProductAudiences(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	out := make(map[uuid.UUID]string, len(ids))
	ids = UniqueUUIDs(ids)
	if len(ids) == 0 {
		return out, nil
	}
	if s.commerceURL == "" || s.internalToken == "" {
		return out, nil
	}
	const chunk = 80
	for i := 0; i < len(ids); i += chunk {
		end := i + chunk
		if end > len(ids) {
			end = len(ids)
		}
		part := ids[i:end]
		raw := make([]string, len(part))
		for j, id := range part {
			raw[j] = id.String()
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.commerceURL+"/v1/internal/products/audiences?ids="+strings.Join(raw, ","), nil)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		req.Header.Set("X-Internal-Token", s.internalToken)
		resp, err := s.httpClient.Do(req)
		if err != nil {
			return nil, apperr.Internal(fmt.Errorf("commerce product audiences: %w", err))
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		if resp.StatusCode >= 300 {
			return nil, apperr.Internal(fmt.Errorf("commerce product audiences status %d", resp.StatusCode))
		}
		var parsed struct {
			Items []struct {
				ID       string `json:"id"`
				Audience string `json:"audience"`
			} `json:"items"`
		}
		if err := json.Unmarshal(body, &parsed); err != nil {
			return nil, apperr.Internal(err)
		}
		for _, it := range parsed.Items {
			id, err := uuid.Parse(it.ID)
			if err != nil {
				continue
			}
			out[id] = it.Audience
		}
	}
	return out, nil
}

type facetBucket struct {
	label string
	n     int
}

func facetsFromArticles(items []domain.KnowledgeArticle) *store.KnowledgeFacets {
	out := &store.KnowledgeFacets{}
	cats := map[string]*facetBucket{}
	brands := map[string]*facetBucket{}
	suppliers := map[string]*facetBucket{}
	for _, a := range items {
		if c := strings.TrimSpace(a.Category); c != "" {
			if cats[c] == nil {
				cats[c] = &facetBucket{label: c}
			}
			cats[c].n++
		}
		if b := strings.TrimSpace(a.Brand); b != "" {
			if brands[b] == nil {
				brands[b] = &facetBucket{label: b}
			}
			brands[b].n++
		}
		if a.AuthorOrgID != nil {
			key := a.AuthorOrgID.String()
			label := strings.TrimSpace(a.AuthorName)
			if label == "" {
				label = "Поставщик"
			}
			if suppliers[key] == nil {
				suppliers[key] = &facetBucket{label: label}
			}
			suppliers[key].n++
		}
	}
	out.Categories = facetList(cats)
	out.Brands = facetList(brands)
	out.Suppliers = facetList(suppliers)
	return out
}

func facetList(src map[string]*facetBucket) []store.KnowledgeFacet {
	out := make([]store.KnowledgeFacet, 0, len(src))
	for value, b := range src {
		out = append(out, store.KnowledgeFacet{Value: value, Label: b.label, Count: b.n})
	}
	return out
}
