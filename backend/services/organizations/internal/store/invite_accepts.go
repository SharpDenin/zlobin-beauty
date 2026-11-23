package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/domain"
)

// AcceptSalonInviteAtomically consumes one use, writes accept ledger, upserts membership.
func (s *Store) AcceptSalonInviteAtomically(ctx context.Context, inv domain.SalonInvite, accept domain.SalonInviteAccept, membership domain.Membership, now time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
UPDATE salon_invites
SET use_count = use_count + 1
WHERE id=$1
  AND revoked_at IS NULL
  AND expires_at > $2
  AND use_count < max_uses`, inv.ID, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}

	_, err = tx.Exec(ctx, `
INSERT INTO salon_invite_accepts(id, invite_id, user_id, role, display_name_snapshot, accepted_at)
VALUES ($1,$2,$3,$4,$5,$6)`,
		accept.ID, accept.InviteID, accept.UserID, accept.Role, accept.DisplayNameSnapshot, accept.AcceptedAt)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
INSERT INTO memberships(id, organization_id, user_id, role, status, created_at)
VALUES ($1,$2,$3,$4,$5,$6)
ON CONFLICT (organization_id, user_id, role) DO UPDATE SET status=EXCLUDED.status`,
		membership.ID, membership.OrganizationID, membership.UserID, membership.Role, membership.Status, membership.CreatedAt)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) ListInviteHistory(ctx context.Context, orgID uuid.UUID) ([]domain.SalonInviteHistoryRow, error) {
	rows, err := s.pool.Query(ctx, `
SELECT i.id, i.organization_id, i.created_by, i.role, i.token_hash, i.expires_at, i.max_uses, i.use_count, i.revoked_at, i.created_at,
       a.accepted_at, a.user_id, a.display_name_snapshot
FROM salon_invites i
LEFT JOIN salon_invite_accepts a ON a.invite_id = i.id
WHERE i.organization_id=$1
ORDER BY i.created_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.SalonInviteHistoryRow
	for rows.Next() {
		var inv domain.SalonInvite
		var acceptedAt *time.Time
		var acceptedUser *uuid.UUID
		var snapshot *string
		if err := rows.Scan(
			&inv.ID, &inv.OrganizationID, &inv.CreatedBy, &inv.Role, &inv.TokenHash,
			&inv.ExpiresAt, &inv.MaxUses, &inv.UseCount, &inv.RevokedAt, &inv.CreatedAt,
			&acceptedAt, &acceptedUser, &snapshot,
		); err != nil {
			return nil, err
		}
		out = append(out, domain.SalonInviteHistoryRow{
			Invite:              inv,
			AcceptedAt:          acceptedAt,
			AcceptedUserID:      acceptedUser,
			DisplayNameSnapshot: snapshot,
		})
	}
	if out == nil {
		out = []domain.SalonInviteHistoryRow{}
	}
	return out, rows.Err()
}

func (s *Store) CountDistinctActiveOwners(ctx context.Context) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(DISTINCT user_id)
FROM memberships
WHERE role = 'owner' AND status = 'active'`).Scan(&n)
	return n, err
}

func (s *Store) GetSalonInviteAccept(ctx context.Context, inviteID uuid.UUID) (*domain.SalonInviteAccept, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, invite_id, user_id, role, display_name_snapshot, accepted_at
FROM salon_invite_accepts WHERE invite_id=$1`, inviteID)
	var a domain.SalonInviteAccept
	if err := row.Scan(&a.ID, &a.InviteID, &a.UserID, &a.Role, &a.DisplayNameSnapshot, &a.AcceptedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &a, nil
}
