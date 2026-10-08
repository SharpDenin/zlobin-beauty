package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/domain"
)

func (s *Store) UpsertPushSubscription(ctx context.Context, sub domain.PushSubscription) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO push_subscriptions(id, user_id, endpoint, p256dh, auth_key, created_at)
VALUES ($1,$2,$3,$4,$5,$6)
ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, p256dh=EXCLUDED.p256dh, auth_key=EXCLUDED.auth_key`,
		sub.ID, sub.UserID, sub.Endpoint, sub.P256dh, sub.Auth, sub.CreatedAt)
	return err
}

func (s *Store) DeletePushSubscription(ctx context.Context, userID uuid.UUID, endpoint string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2`, userID, endpoint)
	return err
}

func (s *Store) ListPushSubscriptions(ctx context.Context, userID uuid.UUID) ([]domain.PushSubscription, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, user_id, endpoint, p256dh, auth_key, created_at
FROM push_subscriptions WHERE user_id=$1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.PushSubscription
	for rows.Next() {
		var sub domain.PushSubscription
		if err := rows.Scan(&sub.ID, &sub.UserID, &sub.Endpoint, &sub.P256dh, &sub.Auth, &sub.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, sub)
	}
	return out, rows.Err()
}
