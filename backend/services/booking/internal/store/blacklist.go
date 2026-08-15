package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

func (s *Store) IsBlacklisted(ctx context.Context, masterID, clientID uuid.UUID) (bool, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM master_client_blacklist
WHERE master_user_id=$1 AND client_user_id=$2 AND unblocked_at IS NULL`, masterID, clientID).Scan(&n)
	return n > 0, err
}

func (s *Store) CountNoShows(ctx context.Context, masterID, clientID uuid.UUID) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM appointments
WHERE master_user_id=$1 AND client_user_id=$2 AND status='no_show'`, masterID, clientID).Scan(&n)
	return n, err
}

func (s *Store) UpsertBlacklist(ctx context.Context, masterID, clientID, actor uuid.UUID, reason string, now time.Time) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO master_client_blacklist(master_user_id, client_user_id, reason, blocked_at, created_by)
VALUES ($1,$2,$3,$4,$5)
ON CONFLICT (master_user_id, client_user_id) DO UPDATE SET
  reason=EXCLUDED.reason, blocked_at=EXCLUDED.blocked_at, unblocked_at=NULL, unblocked_by=NULL, created_by=EXCLUDED.created_by`,
		masterID, clientID, reason, now, actor)
	return err
}

func (s *Store) UnblockClient(ctx context.Context, masterID, clientID, actor uuid.UUID, now time.Time) error {
	_, err := s.pool.Exec(ctx, `
UPDATE master_client_blacklist SET unblocked_at=$3, unblocked_by=$4
WHERE master_user_id=$1 AND client_user_id=$2 AND unblocked_at IS NULL`,
		masterID, clientID, now, actor)
	return err
}

func (s *Store) AddBookingAudit(ctx context.Context, actor uuid.UUID, action, entityType string, entityID uuid.UUID, meta string, now time.Time) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO booking_audit_events(id, actor_user_id, action, entity_type, entity_id, meta, created_at)
VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`, ids.New(), actor, action, entityType, entityID, meta, now)
	return err
}
