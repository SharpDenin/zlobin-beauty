package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/domain"
)

func (s *Store) CreateInvite(ctx context.Context, in domain.SalonInvite) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO salon_invites(id, organization_id, created_by, role, token_hash, expires_at, max_uses, use_count, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		in.ID, in.OrganizationID, in.CreatedBy, in.Role, in.TokenHash, in.ExpiresAt, in.MaxUses, in.UseCount, in.CreatedAt)
	return err
}

func (s *Store) GetInviteByHash(ctx context.Context, hash string) (*domain.SalonInvite, error) {
	return scanInvite(s.pool.QueryRow(ctx, `
SELECT id, organization_id, created_by, role, token_hash, expires_at, max_uses, use_count, revoked_at, created_at
FROM salon_invites WHERE token_hash=$1`, hash))
}

func (s *Store) GetInvite(ctx context.Context, id uuid.UUID) (*domain.SalonInvite, error) {
	return scanInvite(s.pool.QueryRow(ctx, `
SELECT id, organization_id, created_by, role, token_hash, expires_at, max_uses, use_count, revoked_at, created_at
FROM salon_invites WHERE id=$1`, id))
}

func (s *Store) ListInvites(ctx context.Context, orgID uuid.UUID) ([]domain.SalonInvite, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, organization_id, created_by, role, token_hash, expires_at, max_uses, use_count, revoked_at, created_at
FROM salon_invites WHERE organization_id=$1 ORDER BY created_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.SalonInvite
	for rows.Next() {
		inv, err := scanInvite(rows)
		if err != nil {
			return nil, err
		}
		if inv != nil {
			out = append(out, *inv)
		}
	}
	if out == nil {
		out = []domain.SalonInvite{}
	}
	return out, rows.Err()
}

func (s *Store) RevokeInvite(ctx context.Context, id uuid.UUID, at time.Time) error {
	tag, err := s.pool.Exec(ctx, `UPDATE salon_invites SET revoked_at=$2 WHERE id=$1 AND revoked_at IS NULL`, id, at)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) ConsumeInvite(ctx context.Context, id uuid.UUID, now time.Time) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE salon_invites
SET use_count = use_count + 1
WHERE id=$1
  AND revoked_at IS NULL
  AND expires_at > $2
  AND use_count < max_uses`, id, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func scanInvite(row interface{ Scan(dest ...any) error }) (*domain.SalonInvite, error) {
	var in domain.SalonInvite
	if err := row.Scan(&in.ID, &in.OrganizationID, &in.CreatedBy, &in.Role, &in.TokenHash, &in.ExpiresAt, &in.MaxUses, &in.UseCount, &in.RevokedAt, &in.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &in, nil
}
