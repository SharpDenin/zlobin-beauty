package service

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

type DirectoryPublicUser struct {
	ID          uuid.UUID
	DisplayName string
	City        string
	Roles       []string
}

func (s *Service) SearchDirectory(ctx context.Context, q string, limit int) ([]DirectoryPublicUser, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return []DirectoryPublicUser{}, nil
	}
	if limit <= 0 || limit > 10 {
		limit = 10
	}
	items, err := s.store.SearchDirectory(ctx, q, limit)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return toDirectoryPublic(items), nil
}

func (s *Service) BatchDirectory(ctx context.Context, ids []uuid.UUID) ([]DirectoryPublicUser, error) {
	if len(ids) == 0 {
		return []DirectoryPublicUser{}, nil
	}
	if len(ids) > 100 {
		ids = ids[:100]
	}
	items, err := s.store.BatchDirectoryUsers(ctx, ids)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return toDirectoryPublic(items), nil
}

func (s *Service) ResolveDirectory(ctx context.Context, userID *uuid.UUID, email, phone string) (*DirectoryPublicUser, error) {
	u, err := s.store.ResolveDirectoryUser(ctx, userID, email, phone)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if u == nil {
		return nil, apperr.NotFound("user not found")
	}
	if u.Status == "blocked" {
		return nil, apperr.NotFound("user not found")
	}
	for _, r := range u.Roles {
		if r == domain.RoleSystemAdmin {
			return nil, apperr.NotFound("user not found")
		}
	}
	out := DirectoryPublicUser{
		ID: u.ID, DisplayName: u.DisplayName, City: u.City, Roles: sanitizeRoles(u.Roles),
	}
	return &out, nil
}

func toDirectoryPublic(items []store.DirectoryUser) []DirectoryPublicUser {
	out := make([]DirectoryPublicUser, 0, len(items))
	for _, u := range items {
		if u.Status == "blocked" {
			continue
		}
		if hasRole(u.Roles, domain.RoleSystemAdmin) {
			continue
		}
		out = append(out, DirectoryPublicUser{
			ID: u.ID, DisplayName: u.DisplayName, City: u.City, Roles: sanitizeRoles(u.Roles),
		})
	}
	return out
}

func sanitizeRoles(roles []string) []string {
	if roles == nil {
		return []string{}
	}
	out := make([]string, 0, len(roles))
	for _, r := range roles {
		if r == domain.RoleSystemAdmin {
			continue
		}
		out = append(out, r)
	}
	return out
}

func hasRole(roles []string, want string) bool {
	for _, r := range roles {
		if r == want {
			return true
		}
	}
	return false
}
