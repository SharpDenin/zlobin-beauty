package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type assignedProfessionType struct {
	ID       uuid.UUID
	LockedAt *time.Time
}

type professionTypePlan struct {
	KeepIDs []uuid.UUID
	Lock    bool
}

func planProfessionTypes(existing []assignedProfessionType, requested []uuid.UUID, catalog []domain.ProfessionType, create bool, forceLock bool) (*professionTypePlan, error) {
	if len(requested) == 0 {
		return nil, apperr.ProfessionTypesRequired()
	}
	seen := map[uuid.UUID]struct{}{}
	var unique []uuid.UUID
	for _, id := range requested {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	byID := map[uuid.UUID]domain.ProfessionType{}
	for _, t := range catalog {
		byID[t.ID] = t
	}
	for _, id := range unique {
		t, ok := byID[id]
		if !ok {
			return nil, apperr.Validation("profession type not found")
		}
		if !t.IsActive {
			return nil, apperr.Validation("profession type is inactive")
		}
	}
	if !create {
		for _, e := range existing {
			locked := e.LockedAt != nil || forceLock
			if !locked {
				continue
			}
			if _, keep := seen[e.ID]; !keep {
				return nil, apperr.ProfessionTypeLocked()
			}
		}
	}
	return &professionTypePlan{KeepIDs: unique, Lock: forceLock}, nil
}

func (s *Service) ListProfessionTypes(ctx context.Context) ([]domain.ProfessionType, error) {
	items, err := s.store.ListActiveProfessionTypes(ctx)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return items, nil
}

func (s *Service) attachProfessionTypes(ctx context.Context, masters ...*domain.MasterProfile) error {
	ids := make([]uuid.UUID, 0, len(masters))
	for _, m := range masters {
		if m != nil {
			ids = append(ids, m.UserID)
		}
	}
	byUser, err := s.store.ListProfessionTypesForUsers(ctx, ids)
	if err != nil {
		return apperr.Internal(err)
	}
	for _, m := range masters {
		if m == nil {
			continue
		}
		types := byUser[m.UserID]
		if types == nil {
			types = []domain.ProfessionType{}
		}
		m.ProfessionTypes = types
	}
	return nil
}

func (s *Service) applyProfessionTypes(ctx context.Context, m *domain.MasterProfile, requested *[]uuid.UUID, create bool) error {
	existing, err := s.store.ListMasterProfessionTypes(ctx, m.UserID)
	if err != nil {
		return apperr.Internal(err)
	}
	if requested == nil {
		if create || len(existing) == 0 {
			return apperr.ProfessionTypesRequired()
		}
		m.ProfessionTypes = existing
		return nil
	}
	assigned := make([]assignedProfessionType, 0, len(existing))
	for _, t := range existing {
		assigned = append(assigned, assignedProfessionType{ID: t.ID, LockedAt: t.LockedAt})
	}
	svcCount, err := s.store.CountMasterServices(ctx, m.ID)
	if err != nil {
		return apperr.Internal(err)
	}
	forceLock := m.Published || svcCount > 0
	catalog, err := s.store.GetProfessionTypesByIDs(ctx, *requested)
	if err != nil {
		return apperr.Internal(err)
	}
	// Include existing types so inactive-but-already-assigned can stay; requested new ones still validated.
	existingIDs := make([]uuid.UUID, 0, len(existing))
	for _, t := range existing {
		existingIDs = append(existingIDs, t.ID)
	}
	existingCatalog, err := s.store.GetProfessionTypesByIDs(ctx, existingIDs)
	if err != nil {
		return apperr.Internal(err)
	}
	mergedCatalog := append(catalog, existingCatalog...)
	plan, err := planProfessionTypes(assigned, *requested, mergedCatalog, create, forceLock)
	if err != nil {
		return err
	}
	if err := s.store.ReplaceMasterProfessionTypes(ctx, m.UserID, plan.KeepIDs, plan.Lock, s.now().UTC()); err != nil {
		return apperr.Internal(err)
	}
	types, err := s.store.ListMasterProfessionTypes(ctx, m.UserID)
	if err != nil {
		return apperr.Internal(err)
	}
	m.ProfessionTypes = types
	return nil
}

func slugifyProfession(name string) string {
	n := strings.ToLower(strings.TrimSpace(name))
	n = strings.ReplaceAll(n, " ", "_")
	return n
}

func (s *Service) AdminListProfessionTypes(ctx context.Context) ([]domain.ProfessionType, error) {
	items, err := s.store.ListAllProfessionTypes(ctx)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return items, nil
}

func (s *Service) AdminCreateProfessionType(ctx context.Context, name, slug string) (*domain.ProfessionType, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, apperr.Validation("name is required")
	}
	slug = strings.TrimSpace(slug)
	if slug == "" {
		slug = slugifyProfession(name)
	}
	now := s.now().UTC()
	t := domain.ProfessionType{ID: ids.New(), Slug: slug, Name: name, IsActive: true, CreatedAt: now, UpdatedAt: now}
	if err := s.store.CreateProfessionType(ctx, t); err != nil {
		return nil, apperr.Internal(err)
	}
	return &t, nil
}

func (s *Service) AdminSetProfessionTypeActive(ctx context.Context, id uuid.UUID, active bool) error {
	if err := s.store.SetProfessionTypeActive(ctx, id, active, s.now().UTC()); err != nil {
		return apperr.Internal(err)
	}
	return nil
}
