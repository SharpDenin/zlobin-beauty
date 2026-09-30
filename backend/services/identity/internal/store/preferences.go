package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// PreferenceRow is one stored user preference.
type PreferenceRow struct {
	Key       string
	Value     json.RawMessage
	UpdatedAt time.Time
}

func (s *Store) ListPreferences(ctx context.Context, userID uuid.UUID) ([]PreferenceRow, error) {
	rows, err := s.pool.Query(ctx, `SELECT key, value, updated_at FROM user_preferences WHERE user_id=$1 ORDER BY key`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PreferenceRow
	for rows.Next() {
		var r PreferenceRow
		if err := rows.Scan(&r.Key, &r.Value, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) CountPreferences(ctx context.Context, userID uuid.UUID) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM user_preferences WHERE user_id=$1`, userID).Scan(&n)
	return n, err
}

func (s *Store) PreferenceExists(ctx context.Context, userID uuid.UUID, key string) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM user_preferences WHERE user_id=$1 AND key=$2)`, userID, key).Scan(&ok)
	return ok, err
}

func (s *Store) UpsertPreference(ctx context.Context, userID uuid.UUID, key string, value []byte, at time.Time) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO user_preferences(user_id, key, value, updated_at) VALUES ($1,$2,$3::jsonb,$4)
ON CONFLICT (user_id, key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`,
		userID, key, string(value), at)
	return err
}

func (s *Store) DeletePreference(ctx context.Context, userID uuid.UUID, key string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM user_preferences WHERE user_id=$1 AND key=$2`, userID, key)
	return err
}
