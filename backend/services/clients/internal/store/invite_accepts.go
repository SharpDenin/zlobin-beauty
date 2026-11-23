package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/domain"
)

// AcceptClientInviteAtomically consumes one use and inserts the accept ledger in one transaction.
func (s *Store) AcceptClientInviteAtomically(ctx context.Context, inviteID uuid.UUID, accept domain.ClientInviteAccept, now time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
UPDATE client_invites
SET use_count = use_count + 1
WHERE id=$1 AND revoked_at IS NULL AND expires_at > $2 AND use_count < max_uses`, inviteID, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}

	_, err = tx.Exec(ctx, `
INSERT INTO client_invite_accepts(id, invite_id, user_id, display_name_snapshot, accepted_at)
VALUES ($1,$2,$3,$4,$5)`,
		accept.ID, accept.InviteID, accept.UserID, accept.DisplayNameSnapshot, accept.AcceptedAt)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) ListClientInviteHistory(ctx context.Context, masterID uuid.UUID) ([]domain.ClientInviteHistoryRow, error) {
	rows, err := s.pool.Query(ctx, `
SELECT i.id, i.master_user_id, i.organization_id, i.token_hash, i.expires_at, i.max_uses, i.use_count, i.revoked_at, i.created_at,
       a.accepted_at, a.user_id, a.display_name_snapshot
FROM client_invites i
LEFT JOIN client_invite_accepts a ON a.invite_id = i.id
WHERE i.master_user_id=$1
ORDER BY i.created_at DESC
LIMIT 100`, masterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ClientInviteHistoryRow
	for rows.Next() {
		var inv domain.ClientInvite
		var acceptedAt *time.Time
		var acceptedUser *uuid.UUID
		var snapshot *string
		if err := rows.Scan(
			&inv.ID, &inv.MasterUserID, &inv.OrganizationID, &inv.TokenHash,
			&inv.ExpiresAt, &inv.MaxUses, &inv.UseCount, &inv.RevokedAt, &inv.CreatedAt,
			&acceptedAt, &acceptedUser, &snapshot,
		); err != nil {
			return nil, err
		}
		out = append(out, domain.ClientInviteHistoryRow{
			Invite:              inv,
			AcceptedAt:          acceptedAt,
			AcceptedUserID:      acceptedUser,
			DisplayNameSnapshot: snapshot,
		})
	}
	if out == nil {
		out = []domain.ClientInviteHistoryRow{}
	}
	return out, rows.Err()
}
