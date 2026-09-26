package service

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/adminaudit"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func (s *Service) WithIdentity(identityURL string) *Service {
	s.identityURL = strings.TrimRight(identityURL, "/")
	return s
}

func (s *Service) AdminListMasters(ctx context.Context, f store.MasterListFilter) ([]domain.MasterProfile, int, error) {
	items, err := s.store.ListMastersAdmin(ctx, f)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	total, err := s.store.CountMastersAdmin(ctx, f)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	return items, total, nil
}

func (s *Service) AdminGetMaster(ctx context.Context, id uuid.UUID) (*domain.MasterProfile, []domain.ServiceItem, error) {
	m, err := s.store.GetMaster(ctx, id)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if m == nil {
		return nil, nil, apperr.NotFound("master not found")
	}
	svcs, err := s.store.ListMasterServicesAll(ctx, m.ID)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if svcs == nil {
		svcs = []domain.ServiceItem{}
	}
	return m, svcs, nil
}

func (s *Service) AdminSetMasterPublished(ctx context.Context, actor, id uuid.UUID, published bool) (*domain.MasterProfile, error) {
	m, err := s.store.GetMaster(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if m == nil {
		return nil, apperr.NotFound("master not found")
	}
	before := m.Published
	now := s.now().UTC()
	if err := s.store.SetMasterPublished(ctx, id, published, now); err != nil {
		return nil, apperr.Internal(err)
	}
	m.Published = published
	m.UpdatedAt = now
	action := "master.unpublished"
	if published {
		action = "master.published"
	}
	adminaudit.Record(ctx, s.identityURL, s.internalToken, actor, action, "master", &id, map[string]any{
		"before": before, "after": published,
	})
	return m, nil
}

func (s *Service) AdminListServices(ctx context.Context, f store.ServiceListFilter) ([]domain.ServiceItem, int, error) {
	items, err := s.store.ListServicesAdmin(ctx, f)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	total, err := s.store.CountServicesAdmin(ctx, f)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	return items, total, nil
}

func (s *Service) AdminGetService(ctx context.Context, id uuid.UUID) (*domain.ServiceItem, error) {
	item, err := s.store.GetService(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if item == nil {
		return nil, apperr.NotFound("service not found")
	}
	return item, nil
}

func (s *Service) AdminSetServicePublished(ctx context.Context, actor, id uuid.UUID, published bool) (*domain.ServiceItem, error) {
	item, err := s.store.GetService(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if item == nil {
		return nil, apperr.NotFound("service not found")
	}
	before := item.Published
	now := s.now().UTC()
	if err := s.store.SetServicePublished(ctx, id, published, now); err != nil {
		return nil, apperr.Internal(err)
	}
	item.Published = published
	item.UpdatedAt = now
	action := "service.unpublished"
	if published {
		action = "service.published"
	}
	adminaudit.Record(ctx, s.identityURL, s.internalToken, actor, action, "service", &id, map[string]any{
		"before": before, "after": published,
	})
	return item, nil
}

func (s *Service) AdminGetKnowledge(ctx context.Context, id uuid.UUID) (*domain.KnowledgeArticle, error) {
	a, err := s.store.GetKnowledgeArticle(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("article not found")
	}
	if err := s.classifyOneArticle(ctx, a, false); err != nil {
		return nil, err
	}
	return a, nil
}

func (s *Service) AdminSetKnowledgeStatus(ctx context.Context, actor, id uuid.UUID, status string) (*domain.KnowledgeArticle, error) {
	status, err := resolveArticleStatus(status, nil, "")
	if err != nil {
		return nil, err
	}
	a, err := s.store.GetKnowledgeArticle(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("article not found")
	}
	before := a.Status
	now := s.now().UTC()
	applyArticleStatus(a, status, now)
	a.UpdatedAt = now
	if err := s.store.UpdateKnowledgeArticle(ctx, *a); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	adminaudit.Record(ctx, s.identityURL, s.internalToken, actor, "knowledge.status", "knowledge_article", &id, map[string]any{
		"before": before, "after": status,
	})
	if err := s.classifyOneArticle(ctx, a, false); err != nil {
		return a, nil
	}
	return a, nil
}

func (s *Service) AdminMarketplaceStats(ctx context.Context) (store.MarketplaceStats, error) {
	st, err := s.store.MarketplaceStats(ctx)
	if err != nil {
		return st, apperr.Internal(err)
	}
	return st, nil
}
