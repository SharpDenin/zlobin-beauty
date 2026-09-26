package service

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/adminaudit"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func (s *Service) WithAudit(identityURL, internalToken string) *Service {
	s.identityURL = strings.TrimRight(identityURL, "/")
	s.internalToken = internalToken
	return s
}

func (s *Service) AdminListOrgs(ctx context.Context, f store.OrgListFilter) ([]store.OrgListItem, int, error) {
	items, err := s.store.ListOrgsAdmin(ctx, f)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	total, err := s.store.CountOrgsAdmin(ctx, f)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	return items, total, nil
}

func (s *Service) AdminGetOrg(ctx context.Context, id uuid.UUID) (*domain.Organization, []domain.Branch, []domain.Membership, error) {
	org, err := s.store.GetOrg(ctx, id)
	if err != nil {
		return nil, nil, nil, apperr.Internal(err)
	}
	if org == nil {
		return nil, nil, nil, apperr.NotFound("organization not found")
	}
	branches, err := s.store.ListBranches(ctx, id)
	if err != nil {
		return nil, nil, nil, apperr.Internal(err)
	}
	if branches == nil {
		branches = []domain.Branch{}
	}
	members, err := s.store.ListMembershipsByOrg(ctx, id)
	if err != nil {
		return nil, nil, nil, apperr.Internal(err)
	}
	if members == nil {
		members = []domain.Membership{}
	}
	return org, branches, members, nil
}

func (s *Service) AdminSetOrgPublished(ctx context.Context, actor, id uuid.UUID, published bool) (*domain.Organization, error) {
	org, err := s.store.GetOrg(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if org == nil {
		return nil, apperr.NotFound("organization not found")
	}
	before := org.Published
	now := s.now().UTC()
	if err := s.store.SetOrgPublished(ctx, id, published, now); err != nil {
		return nil, apperr.Internal(err)
	}
	org.Published = published
	org.UpdatedAt = now
	action := "organization.unpublished"
	if published {
		action = "organization.published"
	}
	adminaudit.Record(ctx, s.identityURL, s.internalToken, actor, action, "organization", &id, map[string]any{
		"before": before, "after": published,
	})
	return org, nil
}

func (s *Service) AdminOrgStats(ctx context.Context) (store.OrgStats, error) {
	st, err := s.store.OrgStats(ctx)
	if err != nil {
		return st, apperr.Internal(err)
	}
	return st, nil
}
