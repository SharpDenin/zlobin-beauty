package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
)

func (s *Store) InvalidateActiveAuthTokens(ctx context.Context, userID uuid.UUID, purpose string, at time.Time) error {
	_, err := s.pool.Exec(ctx, `
UPDATE auth_action_tokens
SET used_at=$3
WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL`, userID, purpose, at)
	return err
}

func (s *Store) InsertAuthActionToken(ctx context.Context, t domain.AuthActionToken) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO auth_action_tokens(id, user_id, purpose, token_hash, expires_at, used_at, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		t.ID, t.UserID, t.Purpose, t.TokenHash, t.ExpiresAt, t.UsedAt, t.CreatedAt)
	return err
}

func (s *Store) GetAuthActionTokenByHash(ctx context.Context, purpose, hash string) (*domain.AuthActionToken, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, user_id, purpose, token_hash, expires_at, used_at, created_at
FROM auth_action_tokens
WHERE purpose=$1 AND token_hash=$2`, purpose, hash)
	var t domain.AuthActionToken
	if err := row.Scan(&t.ID, &t.UserID, &t.Purpose, &t.TokenHash, &t.ExpiresAt, &t.UsedAt, &t.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &t, nil
}

func (s *Store) MarkAuthActionTokenUsed(ctx context.Context, id uuid.UUID, at time.Time) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
UPDATE auth_action_tokens SET used_at=$2
WHERE id=$1 AND used_at IS NULL AND expires_at > $2`, id, at)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (s *Store) UpdatePasswordHash(ctx context.Context, userID uuid.UUID, hash string, at time.Time) error {
	_, err := s.pool.Exec(ctx, `
UPDATE users SET password_hash=$2, updated_at=$3 WHERE id=$1`, userID, hash, at)
	return err
}

func (s *Store) SetEmailVerified(ctx context.Context, userID uuid.UUID, verified bool, at time.Time) error {
	_, err := s.pool.Exec(ctx, `
UPDATE users SET email_verified=$2, updated_at=$3 WHERE id=$1`, userID, verified, at)
	return err
}

func (s *Store) DeleteExpiredAuthTokens(ctx context.Context, before time.Time) (int64, error) {
	tag, err := s.pool.Exec(ctx, `
DELETE FROM auth_action_tokens
WHERE expires_at < $1 OR (used_at IS NOT NULL AND used_at < $1)`, before)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
