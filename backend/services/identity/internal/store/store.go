package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
)

type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *Store) CreateUser(ctx context.Context, u domain.User) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `
INSERT INTO users (id, email, phone, password_hash, display_name, city, status, email_verified, phone_verified, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		u.ID, u.Email, u.Phone, u.PasswordHash, u.DisplayName, u.City, u.Status, u.EmailVerified, u.PhoneVerified, u.CreatedAt, u.UpdatedAt)
	if err != nil {
		return fmt.Errorf("insert user: %w", err)
	}
	for _, role := range u.Roles {
		if _, err := tx.Exec(ctx, `INSERT INTO user_roles(user_id, role) VALUES ($1,$2)`, u.ID, role); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) GetUserByEmail(ctx context.Context, email string) (*domain.User, error) {
	return s.getUser(ctx, `email = $1`, email)
}

func (s *Store) GetUserByID(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	return s.getUser(ctx, `id = $1`, id)
}

func (s *Store) getUser(ctx context.Context, where string, arg any) (*domain.User, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, email, phone, password_hash, display_name, city, status, email_verified, phone_verified, created_at, updated_at
FROM users WHERE `+where, arg)
	var u domain.User
	if err := row.Scan(&u.ID, &u.Email, &u.Phone, &u.PasswordHash, &u.DisplayName, &u.City, &u.Status, &u.EmailVerified, &u.PhoneVerified, &u.CreatedAt, &u.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	roles, err := s.roles(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	u.Roles = roles
	return &u, nil
}

func (s *Store) UpdateUserProfile(ctx context.Context, id uuid.UUID, displayName, city string, updatedAt time.Time) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE users SET display_name=$2, city=$3, updated_at=$4 WHERE id=$1`,
		id, displayName, city, updatedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) roles(ctx context.Context, userID uuid.UUID) ([]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT role FROM user_roles WHERE user_id=$1 ORDER BY role`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var roles []string
	for rows.Next() {
		var r string
		if err := rows.Scan(&r); err != nil {
			return nil, err
		}
		roles = append(roles, r)
	}
	return roles, rows.Err()
}

func (s *Store) CreateSession(ctx context.Context, sess domain.Session) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO sessions (id, user_id, refresh_token_hash, family_id, user_agent, ip, expires_at, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		sess.ID, sess.UserID, sess.RefreshTokenHash, sess.FamilyID, sess.UserAgent, sess.IP, sess.ExpiresAt, sess.CreatedAt)
	return err
}

func (s *Store) GetSessionByRefreshHash(ctx context.Context, hash string) (*domain.Session, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, user_id, refresh_token_hash, family_id, user_agent, host(ip)::text, expires_at, revoked_at, created_at
FROM sessions WHERE refresh_token_hash=$1`, hash)
	var sess domain.Session
	if err := row.Scan(&sess.ID, &sess.UserID, &sess.RefreshTokenHash, &sess.FamilyID, &sess.UserAgent, &sess.IP, &sess.ExpiresAt, &sess.RevokedAt, &sess.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &sess, nil
}

func (s *Store) RevokeSession(ctx context.Context, id uuid.UUID, at time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE sessions SET revoked_at=$2 WHERE id=$1 AND revoked_at IS NULL`, id, at)
	return err
}

func (s *Store) RevokeFamily(ctx context.Context, familyID uuid.UUID, at time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE sessions SET revoked_at=$2 WHERE family_id=$1 AND revoked_at IS NULL`, familyID, at)
	return err
}

func (s *Store) RotateSession(ctx context.Context, oldID uuid.UUID, next domain.Session, at time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE sessions SET revoked_at=$2 WHERE id=$1 AND revoked_at IS NULL`, oldID, at); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO sessions (id, user_id, refresh_token_hash, family_id, user_agent, ip, expires_at, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		next.ID, next.UserID, next.RefreshTokenHash, next.FamilyID, next.UserAgent, next.IP, next.ExpiresAt, next.CreatedAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) CountRecentFailures(ctx context.Context, key string, since time.Time) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM login_attempts
WHERE key=$1 AND success=FALSE AND attempted_at >= $2`, key, since).Scan(&n)
	return n, err
}

func (s *Store) AddLoginAttempt(ctx context.Context, key string, success bool, at time.Time) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO login_attempts(key, attempted_at, success) VALUES ($1,$2,$3)`, key, at, success)
	return err
}

func (s *Store) AddSecurityEvent(ctx context.Context, id uuid.UUID, userID *uuid.UUID, eventType string, meta []byte, at time.Time) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO security_events(id, user_id, event_type, meta, created_at) VALUES ($1,$2,$3,$4::jsonb,$5)`,
		id, userID, eventType, string(meta), at)
	return err
}

func (s *Store) TryAcquireBootstrap(ctx context.Context) (bool, error) {
	tag, err := s.pool.Exec(ctx, `INSERT INTO bootstrap_lock(id) VALUES (1) ON CONFLICT DO NOTHING`)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}
