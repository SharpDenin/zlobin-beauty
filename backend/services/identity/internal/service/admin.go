package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

	// Block: hide from marketplace search BEFORE flipping identity status so a later
	// identity-batch outage cannot resurrect a blocked master in public search.
	if status == "blocked" {
		if err := s.syncMarketplaceOwnerStatus(ctx, target, "blocked"); err != nil {
			return nil, err
		}
	}

	if err := s.store.SetUserStatus(ctx, target, status, now); err != nil {
		// Compensate marketplace if we already flipped owner_status for a new block.
		if status == "blocked" && before != "blocked" {
			_ = s.syncMarketplaceOwnerStatus(ctx, target, before)
		}
		return nil, apperr.Internal(err)
	}
	if status == "blocked" {
		_ = s.store.RevokeSessionsForUser(ctx, target, now)
	}

	// Unblock: restore search eligibility only after identity is active again.
	if status == "active" {
		if err := s.syncMarketplaceOwnerStatus(ctx, target, "active"); err != nil {
			// Keep search closed: revert identity to blocked so both sides stay consistent.
			_ = s.store.SetUserStatus(ctx, target, "blocked", now)
			_ = s.store.RevokeSessionsForUser(ctx, target, now)
			return nil, err
		}
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

// syncMarketplaceOwnerStatus pushes identity eligibility into marketplace master_profiles.owner_status.
// When marketplace deps are not wired (local/unit), the call is skipped.
// When wired, failure fails the admin action so status changes are not silently half-applied.
func (s *Service) syncMarketplaceOwnerStatus(ctx context.Context, userID uuid.UUID, status string) error {
	if s.marketplaceURL == "" || s.internalToken == "" {
		return nil
	}
	body, _ := json.Marshal(map[string]string{"status": status})
	req, err := http.NewRequestWithContext(ctx, http.MethodPut,
		s.marketplaceURL+"/v1/internal/users/"+userID.String()+"/owner-status", bytes.NewReader(body))
	if err != nil {
		return apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return apperr.Internal(fmt.Errorf("marketplace owner-status: %w", err))
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return apperr.Internal(fmt.Errorf("marketplace owner-status status %d", resp.StatusCode))
	}
	return nil
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
