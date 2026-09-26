package store

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
)

type UserListFilter struct {
	Query  string
	Role   string
	Status string
	Limit  int
	Offset int
}

type AuditListFilter struct {
	Query      string
	ActorID    *uuid.UUID
	EntityType string
	From       *time.Time
	To         *time.Time
	Limit      int
	Offset     int
}

type AuditEvent struct {
	ID         uuid.UUID
	ActorID    *uuid.UUID
	Action     string
	EntityType string
	EntityID   *uuid.UUID
	Meta       json.RawMessage
	CreatedAt  time.Time
}

type UserStats struct {
	UsersTotal   int
	UsersActive  int
	UsersBlocked int
}

func (s *Store) ListUsers(ctx context.Context, f UserListFilter) ([]domain.User, error) {
	limit, offset := page(f.Limit, f.Offset)
	q := strings.TrimSpace(f.Query)
	like := "%" + q + "%"
	rows, err := s.pool.Query(ctx, `
SELECT u.id, u.email, u.phone, u.display_name, u.city, u.status, u.email_verified, u.phone_verified, u.created_at, u.updated_at
FROM users u
WHERE ($1 = '' OR u.display_name ILIKE $2 OR COALESCE(u.email, '') ILIKE $2)
  AND ($3 = '' OR u.status = $3)
  AND ($4 = '' OR EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = $4))
ORDER BY u.created_at DESC
LIMIT $5 OFFSET $6`, q, like, strings.TrimSpace(f.Status), strings.TrimSpace(f.Role), limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.User
	for rows.Next() {
		var u domain.User
		if err := rows.Scan(&u.ID, &u.Email, &u.Phone, &u.DisplayName, &u.City, &u.Status, &u.EmailVerified, &u.PhoneVerified, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		roles, err := s.roles(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Roles = roles
	}
	if out == nil {
		out = []domain.User{}
	}
	return out, nil
}

func (s *Store) CountUsers(ctx context.Context, f UserListFilter) (int, error) {
	q := strings.TrimSpace(f.Query)
	like := "%" + q + "%"
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM users u
WHERE ($1 = '' OR u.display_name ILIKE $2 OR COALESCE(u.email, '') ILIKE $2)
  AND ($3 = '' OR u.status = $3)
  AND ($4 = '' OR EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = $4))`,
		q, like, strings.TrimSpace(f.Status), strings.TrimSpace(f.Role)).Scan(&n)
	return n, err
}

func (s *Store) UserStats(ctx context.Context) (UserStats, error) {
	var st UserStats
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*)::int,
       COUNT(*) FILTER (WHERE status = 'active')::int,
       COUNT(*) FILTER (WHERE status = 'blocked')::int
FROM users`).Scan(&st.UsersTotal, &st.UsersActive, &st.UsersBlocked)
	return st, err
}

func (s *Store) SetUserStatus(ctx context.Context, id uuid.UUID, status string, at time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET status=$2, updated_at=$3 WHERE id=$1`, id, status, at)
	return err
}

func (s *Store) RevokeSessionsForUser(ctx context.Context, userID uuid.UUID, at time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE sessions SET revoked_at=$2 WHERE user_id=$1 AND revoked_at IS NULL`, userID, at)
	return err
}

func (s *Store) ListAudit(ctx context.Context, f AuditListFilter) ([]AuditEvent, error) {
	limit, offset := page(f.Limit, f.Offset)
	q := strings.TrimSpace(f.Query)
	like := "%" + q + "%"
	rows, err := s.pool.Query(ctx, `
SELECT id, actor_user_id, action, entity_type, entity_id, meta, created_at
FROM audit_events
WHERE ($1 = '' OR action ILIKE $2 OR entity_type ILIKE $2)
  AND ($3::uuid IS NULL OR actor_user_id = $3)
  AND ($4 = '' OR entity_type = $4)
  AND ($5::timestamptz IS NULL OR created_at >= $5)
  AND ($6::timestamptz IS NULL OR created_at <= $6)
ORDER BY created_at DESC
LIMIT $7 OFFSET $8`, q, like, f.ActorID, strings.TrimSpace(f.EntityType), f.From, f.To, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditEvent
	for rows.Next() {
		var e AuditEvent
		if err := rows.Scan(&e.ID, &e.ActorID, &e.Action, &e.EntityType, &e.EntityID, &e.Meta, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	if out == nil {
		out = []AuditEvent{}
	}
	return out, rows.Err()
}

func (s *Store) CountAudit(ctx context.Context, f AuditListFilter) (int, error) {
	q := strings.TrimSpace(f.Query)
	like := "%" + q + "%"
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM audit_events
WHERE ($1 = '' OR action ILIKE $2 OR entity_type ILIKE $2)
  AND ($3::uuid IS NULL OR actor_user_id = $3)
  AND ($4 = '' OR entity_type = $4)
  AND ($5::timestamptz IS NULL OR created_at >= $5)
  AND ($6::timestamptz IS NULL OR created_at <= $6)`,
		q, like, f.ActorID, strings.TrimSpace(f.EntityType), f.From, f.To).Scan(&n)
	return n, err
}

func page(limit, offset int) (int, int) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}
