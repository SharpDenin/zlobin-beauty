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
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

func hashClientInviteToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func newClientInviteToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

type CreatedClientInvite struct {
	Invite domain.ClientInvite
	Token  string
	URL    string
}

type PublicClientInvite struct {
	MasterUserID   uuid.UUID `json:"master_user_id"`
	MasterName     string    `json:"master_name"`
	OrganizationID string    `json:"organization_id,omitempty"`
	ExpiresAt      time.Time `json:"expires_at"`
}

func (s *Service) CreateClientInvite(ctx context.Context, masterID uuid.UUID, orgID *uuid.UUID, ttl time.Duration, maxUses int) (*CreatedClientInvite, error) {
	if masterID == uuid.Nil {
		return nil, apperr.Validation("master required")
	}
	if orgID != nil && *orgID != uuid.Nil {
		if !s.membershipHas(ctx, *orgID, masterID, "owner", "admin", "master") {
			return nil, apperr.Forbidden("not a member of this organization")
		}
	}
	if ttl <= 0 {
		ttl = 7 * 24 * time.Hour
	}
	if ttl > 30*24*time.Hour {
		ttl = 30 * 24 * time.Hour
	}
	if maxUses <= 0 {
		maxUses = 20
	}
	if maxUses > 100 {
		maxUses = 100
	}
	token, err := newClientInviteToken()
	if err != nil {
		return nil, apperr.Internal(err)
	}
	now := s.now().UTC()
	inv := domain.ClientInvite{
		ID: ids.New(), MasterUserID: masterID, OrganizationID: orgID,
		TokenHash: hashClientInviteToken(token), ExpiresAt: now.Add(ttl),
		MaxUses: maxUses, UseCount: 0, CreatedAt: now,
	}
	if err := s.store.CreateClientInvite(ctx, inv); err != nil {
		return nil, apperr.Internal(err)
	}
	// URL is assembled by the HTTP layer (PUBLIC_APP_URL / Origin / Host).
	return &CreatedClientInvite{Invite: inv, Token: token}, nil
}

func (s *Service) ListClientInvites(ctx context.Context, masterID uuid.UUID) ([]domain.ClientInvite, error) {
	items, err := s.store.ListClientInvitesByMaster(ctx, masterID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return items, nil
}

func (s *Service) RevokeClientInvite(ctx context.Context, masterID, inviteID uuid.UUID) error {
	if err := s.store.RevokeClientInvite(ctx, inviteID, masterID, s.now().UTC()); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.InviteRevoked()
		}
		return apperr.Internal(err)
	}
	return nil
}

func (s *Service) PeekClientInvite(ctx context.Context, token string) (*PublicClientInvite, error) {
	inv, err := s.loadActiveClientInvite(ctx, token)
	if err != nil {
		return nil, err
	}
	name := "Мастер"
	if n, err := s.lookupMasterDisplayName(ctx, inv.MasterUserID); err == nil && n != "" {
		name = n
	}
	out := &PublicClientInvite{
		MasterUserID: inv.MasterUserID,
		MasterName:   name,
		ExpiresAt:    inv.ExpiresAt,
	}
	if inv.OrganizationID != nil {
		out.OrganizationID = inv.OrganizationID.String()
	}
	return out, nil
}

func (s *Service) AcceptClientInvite(ctx context.Context, token string, clientID uuid.UUID, clientName string, phone, email *string) (*PublicClientInvite, error) {
	inv, err := s.loadActiveClientInvite(ctx, token)
	if err != nil {
		return nil, err
	}
	if clientID == inv.MasterUserID {
		return nil, apperr.Unprocessable(apperr.CodeContactSelf, "cannot accept your own invite")
	}
	if err := s.store.ConsumeClientInvite(ctx, inv.ID, s.now().UTC()); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperr.InviteExhausted()
		}
		return nil, apperr.Internal(err)
	}
	if inv.OrganizationID != nil && *inv.OrganizationID != uuid.Nil {
		if _, err := s.store.EnsureClientCard(ctx, *inv.OrganizationID, clientID, clientName, phone, email); err != nil {
			return nil, apperr.Internal(err)
		}
	}
	if err := s.linkMutualContacts(ctx, inv.MasterUserID, clientID); err != nil {
		// Card already applied; contact link is best-effort for UX.
		_ = err
	}
	name := "Мастер"
	if n, err := s.lookupMasterDisplayName(ctx, inv.MasterUserID); err == nil && n != "" {
		name = n
	}
	out := &PublicClientInvite{
		MasterUserID: inv.MasterUserID,
		MasterName:   name,
		ExpiresAt:    inv.ExpiresAt,
	}
	if inv.OrganizationID != nil {
		out.OrganizationID = inv.OrganizationID.String()
	}
	return out, nil
}

func (s *Service) loadActiveClientInvite(ctx context.Context, token string) (*domain.ClientInvite, error) {
	token = strings.TrimSpace(token)
	if len(token) < 16 {
		return nil, apperr.InviteInvalid()
	}
	inv, err := s.store.GetClientInviteByHash(ctx, hashClientInviteToken(token))
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

func (s *Service) lookupMasterDisplayName(ctx context.Context, masterUserID uuid.UUID) (string, error) {
	if s.marketplaceURL == "" || s.internalToken == "" {
		return "", fmt.Errorf("marketplace not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.marketplaceURL+"/v1/internal/masters/by-user/"+masterUserID.String(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	res, err := s.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("marketplace status %d", res.StatusCode)
	}
	var body struct {
		DisplayName string `json:"display_name"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return "", err
	}
	return strings.TrimSpace(body.DisplayName), nil
}

func (s *Service) linkMutualContacts(ctx context.Context, masterID, clientID uuid.UUID) error {
	if s.communicationsURL == "" || s.internalToken == "" {
		return fmt.Errorf("communications not configured")
	}
	payload, _ := json.Marshal(map[string]string{
		"user_a": masterID.String(),
		"user_b": clientID.String(),
		"note":   "Приглашение клиента",
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.communicationsURL+"/v1/internal/contacts/link", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", s.internalToken)
	res, err := s.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("link contacts: %s %s", res.Status, string(b))
	}
	return nil
}
