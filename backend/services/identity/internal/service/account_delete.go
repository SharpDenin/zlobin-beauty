package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/auth"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type ownedOrg struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}

// AccountCleanupResult reports idempotent cross-service cleanup outcomes.
type AccountCleanupResult struct {
	Memberships string `json:"memberships"` // ok|skipped|failed
	Push        string `json:"push"`
	Master      string `json:"master"`
	Failed      []string `json:"failed,omitempty"`
}

// WithAccountDeleteDeps wires cross-service cleanup of org memberships, push, and master visibility.
func (s *Service) WithAccountDeleteDeps(organizationsURL, communicationsURL, marketplaceURL, internalToken string) *Service {
	s.organizationsURL = strings.TrimRight(strings.TrimSpace(organizationsURL), "/")
	s.communicationsURL = strings.TrimRight(strings.TrimSpace(communicationsURL), "/")
	s.marketplaceURL = strings.TrimRight(strings.TrimSpace(marketplaceURL), "/")
	if tok := strings.TrimSpace(internalToken); tok != "" {
		s.internalToken = tok
	}
	return s
}

// DeleteMyAccount soft-deletes the authenticated user after password confirmation.
// Cross-service cleanup runs first and must succeed when dependencies are configured;
// otherwise the account is left intact so the client can retry safely.
// Appointments, messages, orders and audits stay; PII is anonymized and sessions revoked.
// Active organization owners must transfer or close ownership first.
func (s *Service) DeleteMyAccount(ctx context.Context, userID uuid.UUID, password string) error {
	password = strings.TrimSpace(password)
	if password == "" {
		return apperr.Validation("password is required")
	}
	user, err := s.store.GetUserByID(ctx, userID)
	if err != nil {
		return apperr.Internal(err)
	}
	if user == nil {
		return apperr.NotFound("user not found")
	}
	if user.Status == "deleted" {
		// Allow password-less recovery path only via RunAccountCleanup (internal).
		return apperr.AccountAlreadyDeleted()
	}
	for _, r := range user.Roles {
		if r == domain.RoleSystemAdmin {
			return apperr.Forbidden("platform admin accounts cannot be self-deleted")
		}
	}
	if !auth.VerifyPassword(user.PasswordHash, password) {
		return apperr.InvalidCredentials()
	}

	owned, err := s.listOwnedOrganizations(ctx, userID, user.Roles)
	if err != nil {
		return err
	}
	if len(owned) > 0 {
		names := make([]string, 0, len(owned))
		for _, o := range owned {
			if strings.TrimSpace(o.Name) != "" {
				names = append(names, o.Name)
			} else {
				names = append(names, o.ID)
			}
		}
		return apperr.AccountOwnedOrganizations(names)
	}

	// Required cleanup before soft-delete so a dependency outage never leaves a
	// "deleted" user still published / still receiving push.
	cleanup, err := s.RunAccountCleanup(ctx, userID)
	if err != nil {
		return err
	}
	if len(cleanup.Failed) > 0 {
		return apperr.AccountCleanupFailed(cleanup.Failed)
	}

	now := s.now().UTC()
	anonEmail := fmt.Sprintf("deleted+%s@deleted.invalid", userID.String())
	hash, err := auth.HashPassword(ids.New().String() + ids.New().String())
	if err != nil {
		return apperr.Internal(err)
	}
	changed, err := s.store.SoftDeleteUser(ctx, userID, anonEmail, "Удалённый аккаунт", hash, now)
	if err != nil {
		return apperr.Internal(err)
	}
	if !changed {
		return apperr.AccountAlreadyDeleted()
	}

	if err := s.store.RevokeSessionsForUser(ctx, userID, now); err != nil {
		return apperr.Internal(err)
	}
	_ = s.store.InvalidateActiveAuthTokens(ctx, userID, domain.AuthPurposePasswordReset, now)
	_ = s.store.InvalidateActiveAuthTokens(ctx, userID, domain.AuthPurposeEmailVerify, now)

	meta, _ := json.Marshal(map[string]any{"status": "deleted", "cleanup": cleanup})
	_ = s.store.AddAudit(ctx, ids.New(), userID, "user.self_deleted", "user", &userID, meta, now)
	_ = s.security(ctx, &userID, "account.self_deleted", map[string]any{})

	// Idempotent confirmation after revoke (safe if deps flap mid-delete).
	if again, err := s.RunAccountCleanup(ctx, userID); err == nil && len(again.Failed) > 0 && s.log != nil {
		s.log.Warn("account delete: post-revoke cleanup incomplete", "failed_steps", again.Failed)
	}
	return nil
}

// RunAccountCleanup performs idempotent cross-service cleanup. Used before soft-delete
// and by the internal retry endpoint after a partial outage.
func (s *Service) RunAccountCleanup(ctx context.Context, userID uuid.UUID) (AccountCleanupResult, error) {
	out := AccountCleanupResult{
		Memberships: "skipped",
		Push:        "skipped",
		Master:      "skipped",
	}
	if st, err := s.cleanupMemberships(ctx, userID); err != nil {
		return out, err
	} else {
		out.Memberships = st
		if st == "failed" {
			out.Failed = append(out.Failed, "memberships")
		}
	}
	if st, err := s.cleanupPush(ctx, userID); err != nil {
		return out, err
	} else {
		out.Push = st
		if st == "failed" {
			out.Failed = append(out.Failed, "push")
		}
	}
	if st, err := s.cleanupMaster(ctx, userID); err != nil {
		return out, err
	} else {
		out.Master = st
		if st == "failed" {
			out.Failed = append(out.Failed, "master")
		}
	}
	return out, nil
}

func (s *Service) listOwnedOrganizations(ctx context.Context, userID uuid.UUID, roles []string) ([]ownedOrg, error) {
	if s.organizationsURL == "" || s.internalToken == "" {
		// Fail closed for roles that typically own orgs when the dependency is missing.
		if domain.HasAnyRole(roles, domain.RoleSalonOwner, domain.RoleSupplier) {
			return nil, apperr.Conflict("cannot verify organization ownership; deletion temporarily unavailable")
		}
		return nil, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		s.organizationsURL+"/v1/internal/users/"+userID.String()+"/owned-organizations", nil)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return nil, apperr.Internal(fmt.Errorf("organizations owned lookup status %d", resp.StatusCode))
	}
	var out struct {
		Items []ownedOrg `json:"items"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, apperr.Internal(err)
	}
	return out.Items, nil
}

func (s *Service) cleanupMemberships(ctx context.Context, userID uuid.UUID) (string, error) {
	if s.organizationsURL == "" || s.internalToken == "" {
		return "skipped", nil
	}
	ok, err := s.internalPOST(ctx, s.organizationsURL+"/v1/internal/users/"+userID.String()+"/deactivate-memberships")
	if err != nil {
		return "failed", nil
	}
	if !ok {
		return "failed", nil
	}
	return "ok", nil
}

func (s *Service) cleanupPush(ctx context.Context, userID uuid.UUID) (string, error) {
	if s.communicationsURL == "" || s.internalToken == "" {
		return "skipped", nil
	}
	ok, err := s.internalDELETE(ctx, s.communicationsURL+"/v1/internal/users/"+userID.String()+"/push-subscriptions")
	if err != nil {
		return "failed", nil
	}
	if !ok {
		return "failed", nil
	}
	return "ok", nil
}

func (s *Service) cleanupMaster(ctx context.Context, userID uuid.UUID) (string, error) {
	if s.marketplaceURL == "" || s.internalToken == "" {
		return "skipped", nil
	}
	ok, err := s.internalPOST(ctx, s.marketplaceURL+"/v1/internal/users/"+userID.String()+"/unpublish-master")
	if err != nil {
		return "failed", nil
	}
	if !ok {
		return "failed", nil
	}
	return "ok", nil
}

func (s *Service) internalPOST(ctx context.Context, url string) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode < 300, nil
}

func (s *Service) internalDELETE(ctx context.Context, url string) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, url, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode < 300, nil
}
