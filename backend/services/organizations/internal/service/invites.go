package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

var identityHTTP = &http.Client{Timeout: 5 * time.Second}

func hashInviteToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func newInviteToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

type CreatedInvite struct {
	Invite domain.SalonInvite
	Token  string
}

func (s *Service) CreateInvite(ctx context.Context, orgID, actor uuid.UUID, role string, ttl time.Duration, maxUses int) (*CreatedInvite, error) {
	if err := s.requireOwnerAdmin(ctx, orgID, actor); err != nil {
		return nil, err
	}
	org, err := s.GetOrg(ctx, orgID)
	if err != nil {
		return nil, err
	}
	if org.Type != "salon" {
		return nil, apperr.Validation("invites belong to a salon")
	}
	role = strings.TrimSpace(role)
	switch role {
	case "master", "admin", "staff":
	default:
		return nil, apperr.Validation("invalid invite role")
	}
	if ttl <= 0 {
		ttl = 72 * time.Hour
	}
	if ttl > 30*24*time.Hour {
		ttl = 30 * 24 * time.Hour
	}
	if maxUses <= 0 {
		maxUses = 10
	}
	if maxUses > 100 {
		maxUses = 100
	}
	token, err := newInviteToken()
	if err != nil {
		return nil, apperr.Internal(err)
	}
	now := s.now().UTC()
	inv := domain.SalonInvite{
		ID: ids.New(), OrganizationID: orgID, CreatedBy: actor, Role: role,
		TokenHash: hashInviteToken(token), ExpiresAt: now.Add(ttl), MaxUses: maxUses, CreatedAt: now,
	}
	if err := s.store.CreateInvite(ctx, inv); err != nil {
		return nil, apperr.Internal(err)
	}
	return &CreatedInvite{Invite: inv, Token: token}, nil
}

func (s *Service) ListInvites(ctx context.Context, orgID, actor uuid.UUID) ([]domain.SalonInvite, error) {
	if err := s.requireOwnerAdmin(ctx, orgID, actor); err != nil {
		return nil, err
	}
	items, err := s.store.ListInvites(ctx, orgID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return items, nil
}

func (s *Service) RevokeInvite(ctx context.Context, orgID, actor, inviteID uuid.UUID) error {
	if err := s.requireOwnerAdmin(ctx, orgID, actor); err != nil {
		return err
	}
	inv, err := s.store.GetInvite(ctx, inviteID)
	if err != nil {
		return apperr.Internal(err)
	}
	if inv == nil || inv.OrganizationID != orgID {
		return apperr.InviteInvalid()
	}
	if err := s.store.RevokeInvite(ctx, inviteID, s.now().UTC()); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.InviteRevoked()
		}
		return apperr.Internal(err)
	}
	return nil
}

type PublicInvite struct {
	OrganizationID   uuid.UUID
	OrganizationName string
	Role             string
	ExpiresAt        time.Time
}

func (s *Service) PeekInvite(ctx context.Context, token string) (*PublicInvite, error) {
	inv, err := s.loadActiveInvite(ctx, token)
	if err != nil {
		return nil, err
	}
	org, err := s.GetOrg(ctx, inv.OrganizationID)
	if err != nil {
		return nil, err
	}
	return &PublicInvite{
		OrganizationID: org.ID, OrganizationName: org.Name, Role: inv.Role, ExpiresAt: inv.ExpiresAt,
	}, nil
}

func (s *Service) AcceptInvite(ctx context.Context, token string, actor uuid.UUID) (*PublicInvite, error) {
	inv, err := s.loadActiveInvite(ctx, token)
	if err != nil {
		return nil, err
	}
	if err := s.store.ConsumeInvite(ctx, inv.ID, s.now().UTC()); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperr.InviteExhausted()
		}
		return nil, apperr.Internal(err)
	}
	now := s.now().UTC()
	if err := s.store.UpsertMembership(ctx, domain.Membership{
		ID: ids.New(), OrganizationID: inv.OrganizationID, UserID: actor, Role: inv.Role, Status: "active", CreatedAt: now,
	}); err != nil {
		return nil, apperr.Internal(err)
	}
	if err := s.grantIdentityRole(ctx, actor, inv.Role); err != nil {
		return nil, err
	}
	org, err := s.GetOrg(ctx, inv.OrganizationID)
	if err != nil {
		return nil, err
	}
	meta, _ := json.Marshal(map[string]any{"role": inv.Role, "invite_id": inv.ID.String()})
	_ = s.store.AddOrgAudit(ctx, ids.New(), inv.OrganizationID, &actor, "invite.accepted", "membership", &actor, meta, now)
	return &PublicInvite{
		OrganizationID: org.ID, OrganizationName: org.Name, Role: inv.Role, ExpiresAt: inv.ExpiresAt,
	}, nil
}

func (s *Service) loadActiveInvite(ctx context.Context, token string) (*domain.SalonInvite, error) {
	token = strings.TrimSpace(token)
	if len(token) < 16 {
		return nil, apperr.InviteInvalid()
	}
	inv, err := s.store.GetInviteByHash(ctx, hashInviteToken(token))
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if inv == nil {
		return nil, apperr.InviteInvalid()
	}
	if inv.RevokedAt != nil {
		return nil, apperr.InviteRevoked()
	}
	if !inv.ExpiresAt.After(s.now().UTC()) {
		return nil, apperr.InviteExpired()
	}
	if inv.UseCount >= inv.MaxUses {
		return nil, apperr.InviteExhausted()
	}
	return inv, nil
}

func (s *Service) grantIdentityRole(ctx context.Context, userID uuid.UUID, membershipRole string) error {
	if s.identityURL == "" || s.internalToken == "" {
		return nil
	}
	identRole := "master"
	switch membershipRole {
	case "admin":
		identRole = "salon_admin"
	case "rep":
		identRole = "supplier_rep"
	}
	body, err := json.Marshal(map[string]any{"user_id": userID.String(), "role": identRole})
	if err != nil {
		return apperr.Internal(err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.identityURL+"/v1/internal/users/grant-role", bytes.NewReader(body))
	if err != nil {
		return apperr.Internal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := identityHTTP.Do(req)
	if err != nil {
		return apperr.Internal(fmt.Errorf("grant role: %w", err))
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode >= 300 {
		return apperr.Internal(fmt.Errorf("grant role status %d", resp.StatusCode))
	}
	return nil
}
