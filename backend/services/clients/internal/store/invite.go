package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

const inviteCols = `id, master_user_id, organization_id, token_hash, expires_at, max_uses, use_count, revoked_at, created_at`

func scanInvite(row interface{ Scan(dest ...any) error }) (*domain.ClientInvite, error) {
	var inv domain.ClientInvite
	if err := row.Scan(
		&inv.ID, &inv.MasterUserID, &inv.OrganizationID, &inv.TokenHash,
		&inv.ExpiresAt, &inv.MaxUses, &inv.UseCount, &inv.RevokedAt, &inv.CreatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &inv, nil
}

func (s *Store) CreateClientInvite(ctx context.Context, inv domain.ClientInvite) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO client_invites(id, master_user_id, organization_id, token_hash, expires_at, max_uses, use_count, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		inv.ID, inv.MasterUserID, inv.OrganizationID, inv.TokenHash, inv.ExpiresAt, inv.MaxUses, inv.UseCount, inv.CreatedAt)
	return err
}

func (s *Store) GetClientInviteByHash(ctx context.Context, hash string) (*domain.ClientInvite, error) {
	return scanInvite(s.pool.QueryRow(ctx, `SELECT `+inviteCols+` FROM client_invites WHERE token_hash=$1`, hash))
}

func (s *Store) GetClientInvite(ctx context.Context, id uuid.UUID) (*domain.ClientInvite, error) {
	return scanInvite(s.pool.QueryRow(ctx, `SELECT `+inviteCols+` FROM client_invites WHERE id=$1`, id))
}

func (s *Store) ListClientInvitesByMaster(ctx context.Context, masterID uuid.UUID) ([]domain.ClientInvite, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+inviteCols+` FROM client_invites WHERE master_user_id=$1 ORDER BY created_at DESC LIMIT 50`, masterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ClientInvite
	for rows.Next() {
		inv, err := scanInvite(rows)
		if err != nil {
			return nil, err
		}
		if inv != nil {
			out = append(out, *inv)
		}
	}
	return out, rows.Err()
}

func (s *Store) RevokeClientInvite(ctx context.Context, id, masterID uuid.UUID, at time.Time) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE client_invites SET revoked_at=$3
WHERE id=$1 AND master_user_id=$2 AND revoked_at IS NULL`, id, masterID, at)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) ConsumeClientInvite(ctx context.Context, id uuid.UUID, at time.Time) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE client_invites
SET use_count = use_count + 1
WHERE id=$1 AND revoked_at IS NULL AND expires_at > $2 AND use_count < max_uses`, id, at)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) EnsureClientCard(ctx context.Context, orgID, clientUserID uuid.UUID, displayName string, phone, email *string) (*domain.ClientCard, error) {
	now := time.Now().UTC()
	name := displayName
	if name == "" {
		name = "Клиент"
	}
	return scanCard(s.pool.QueryRow(ctx, `
INSERT INTO client_cards(id, organization_id, user_id, display_name, phone, email, preferences, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,'',$7,$7)
ON CONFLICT (organization_id, user_id) DO UPDATE SET
  display_name = CASE WHEN EXCLUDED.display_name <> '' AND EXCLUDED.display_name <> 'Клиент' THEN EXCLUDED.display_name ELSE client_cards.display_name END,
  phone = COALESCE(EXCLUDED.phone, client_cards.phone),
  email = COALESCE(EXCLUDED.email, client_cards.email),
  updated_at = EXCLUDED.updated_at
RETURNING `+cardColumns,
		ids.New(), orgID, clientUserID, name, phone, email, now,
	))
}
