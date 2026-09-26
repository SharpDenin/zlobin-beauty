package service

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

func ValidateAdminUserStatusChange(actor, target uuid.UUID, targetRoles []string, status, reason string) error {
	if actor == target {
		return apperr.Forbidden("cannot change your own account status")
	}
	for _, r := range targetRoles {
		if r == domain.RoleSystemAdmin {
			return apperr.Forbidden("cannot change another platform admin")
		}
	}
	status = strings.TrimSpace(status)
	if status != "active" && status != "blocked" {
		return apperr.Validation("status must be active or blocked")
	}
	if status == "blocked" && strings.TrimSpace(reason) == "" {
		return apperr.Validation("reason is required")
	}
	return nil
}

func (s *Service) AdminListUsers(ctx context.Context, f store.UserListFilter) ([]domain.User, int, error) {
	items, err := s.store.ListUsers(ctx, f)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	total, err := s.store.CountUsers(ctx, f)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	return items, total, nil
}

func (s *Service) AdminGetUser(ctx context.Context, id uuid.UUID) (*domain.User, *domain.Subscription, error) {
	user, err := s.store.GetUserByID(ctx, id)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if user == nil {
		return nil, nil, apperr.NotFound("user not found")
	}
	sub, err := s.store.GetSubscription(ctx, id)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	return user, sub, nil
}

func (s *Service) AdminSetUserStatus(ctx context.Context, actor, target uuid.UUID, status, reason string) (*domain.User, error) {
	user, err := s.store.GetUserByID(ctx, target)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if user == nil {
		return nil, apperr.NotFound("user not found")
	}
	if err := ValidateAdminUserStatusChange(actor, target, user.Roles, status, reason); err != nil {
		return nil, err
	}
	before := user.Status
	now := s.now().UTC()
	if err := s.store.SetUserStatus(ctx, target, status, now); err != nil {
		return nil, apperr.Internal(err)
	}
	if status == "blocked" {
		_ = s.store.RevokeSessionsForUser(ctx, target, now)
	}
	action := "user.unblocked"
	if status == "blocked" {
		action = "user.blocked"
	}
	meta, _ := json.Marshal(map[string]any{
		"reason": strings.TrimSpace(reason),
		"before": before,
		"after":  status,
	})
	_ = s.store.AddAudit(ctx, ids.New(), actor, action, "user", &target, meta, now)
	user.Status = status
	user.UpdatedAt = now
	return user, nil
}

func (s *Service) AdminUserStats(ctx context.Context) (store.UserStats, error) {
	st, err := s.store.UserStats(ctx)
	if err != nil {
		return st, apperr.Internal(err)
	}
	return st, nil
}

func (s *Service) AdminListAudit(ctx context.Context, f store.AuditListFilter) ([]store.AuditEvent, int, error) {
	items, err := s.store.ListAudit(ctx, f)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	total, err := s.store.CountAudit(ctx, f)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	return items, total, nil
}

func (s *Service) IngestAudit(ctx context.Context, actor uuid.UUID, action, entityType string, entityID *uuid.UUID, meta json.RawMessage) error {
	action = strings.TrimSpace(action)
	entityType = strings.TrimSpace(entityType)
	if action == "" || entityType == "" {
		return apperr.Validation("action and entity_type are required")
	}
	if len(meta) == 0 {
		meta = json.RawMessage(`{}`)
	}
	return s.store.AddAudit(ctx, ids.New(), actor, action, entityType, entityID, meta, time.Now().UTC())
}

func SanitizeAuditMeta(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(`{}`)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return json.RawMessage(`{}`)
	}
	for _, key := range []string{"password", "token", "refresh_token", "access_token", "secret", "jwt"} {
		delete(m, key)
	}
	out, err := json.Marshal(m)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return out
}
