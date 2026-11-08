package service

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func specializationKey(tag string) string {
	return strings.ToLower(domain.NormalizeSpecializationTag(tag))
}

func sameProfessionTypeIDs(existing []domain.ProfessionType, requested []uuid.UUID) bool {
	if len(existing) != len(requested) {
		return false
	}
	have := map[uuid.UUID]struct{}{}
	for _, t := range existing {
		have[t.ID] = struct{}{}
	}
	for _, id := range requested {
		if _, ok := have[id]; !ok {
			return false
		}
	}
	return true
}

func (s *Service) professionSlugsForTypes(ctx context.Context, types []domain.ProfessionType) ([]string, error) {
	ids := make([]uuid.UUID, 0, len(types))
	for _, t := range types {
		if t.ID != uuid.Nil {
			ids = append(ids, t.ID)
		}
	}
	if len(ids) == 0 {
		return nil, nil
	}
	// Prefer slugs already loaded on the type objects.
	out := make([]string, 0, len(types))
	missing := make([]uuid.UUID, 0)
	seen := map[string]struct{}{}
	for _, t := range types {
		slug := strings.TrimSpace(t.Slug)
		if slug != "" {
			if _, ok := seen[slug]; !ok {
				seen[slug] = struct{}{}
				out = append(out, slug)
			}
			continue
		}
		if t.ID != uuid.Nil {
			missing = append(missing, t.ID)
		}
	}
	if len(missing) == 0 {
		return out, nil
	}
	loaded, err := s.store.GetProfessionTypesByIDs(ctx, missing)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	for _, t := range loaded {
		slug := strings.TrimSpace(t.Slug)
		if slug == "" {
			continue
		}
		if _, ok := seen[slug]; ok {
			continue
		}
		seen[slug] = struct{}{}
		out = append(out, slug)
	}
	return out, nil
}

// resolveSpecializations validates tags against the catalog for selected profession slugs.
// Legacy tags already stored on the profile are grandfathered while profession types stay unchanged.
func resolveSpecializations(submitted []string, slugs []string, existing *domain.MasterProfile, typesChanged bool) ([]string, error) {
	unique := domain.UniqueSpecializations(submitted)
	allowed := domain.AllowedSpecializationsForSlugs(slugs)
	prev := map[string]string{}
	if existing != nil {
		for _, t := range existing.Specializations {
			key := specializationKey(t)
			if key == "" {
				continue
			}
			prev[key] = domain.NormalizeSpecializationTag(t)
		}
	}
	out := make([]string, 0, len(unique))
	seen := map[string]struct{}{}
	for _, tag := range unique {
		key := specializationKey(tag)
		if canon, ok := allowed[key]; ok {
			if _, dup := seen[key]; dup {
				continue
			}
			seen[key] = struct{}{}
			out = append(out, canon)
			continue
		}
		if !typesChanged {
			if old, ok := prev[key]; ok {
				if _, dup := seen[key]; dup {
					continue
				}
				seen[key] = struct{}{}
				out = append(out, old)
				continue
			}
		}
		return nil, apperr.Validation("specialization is not allowed for selected profession types")
	}
	if out == nil {
		out = []string{}
	}
	return out, nil
}
