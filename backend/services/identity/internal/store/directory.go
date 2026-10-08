package store

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
)

// DirectoryUser is a public-safe identity projection for service-to-service lookups.
type DirectoryUser struct {
	ID          uuid.UUID
	DisplayName string
	City        string
	Status      string
	Roles       []string
}

func (s *Store) SearchDirectory(ctx context.Context, q string, limit int) ([]DirectoryUser, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return []DirectoryUser{}, nil
	}
	if limit <= 0 || limit > 10 {
		limit = 10
	}
	email := strings.ToLower(q)
	phone := normalizePhone(q)
	prefix := q + "%"
	contains := "%" + q + "%"
	rows, err := s.pool.Query(ctx, `
SELECT u.id, u.display_name, u.city, u.status
FROM users u
WHERE u.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = $5
  )
  AND (
    u.display_name ILIKE $1
    OR u.display_name ILIKE $2
    OR lower(COALESCE(u.email, '')) = $3
    OR regexp_replace(COALESCE(u.phone, ''), '[^0-9+]', '', 'g') = $4
  )
ORDER BY
  CASE WHEN u.display_name ILIKE $1 THEN 0 ELSE 1 END,
  u.display_name ASC
LIMIT $6`, prefix, contains, email, phone, domain.RoleSystemAdmin, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DirectoryUser
	for rows.Next() {
		var u DirectoryUser
		if err := rows.Scan(&u.ID, &u.DisplayName, &u.City, &u.Status); err != nil {
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
		out = []DirectoryUser{}
	}
	return out, nil
}

func (s *Store) BatchDirectoryUsers(ctx context.Context, ids []uuid.UUID) ([]DirectoryUser, error) {
	if len(ids) == 0 {
		return []DirectoryUser{}, nil
	}
	rows, err := s.pool.Query(ctx, `
SELECT id, display_name, city, status
FROM users
WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DirectoryUser
	for rows.Next() {
		var u DirectoryUser
		if err := rows.Scan(&u.ID, &u.DisplayName, &u.City, &u.Status); err != nil {
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
		out = []DirectoryUser{}
	}
	return out, nil
}

func (s *Store) ResolveDirectoryUser(ctx context.Context, userID *uuid.UUID, email, phone string) (*DirectoryUser, error) {
	if userID != nil {
		u, err := s.GetUserByID(ctx, *userID)
		if err != nil {
			return nil, err
		}
		if u == nil {
			return nil, nil
		}
		return &DirectoryUser{
			ID: u.ID, DisplayName: u.DisplayName, City: u.City, Status: u.Status, Roles: u.Roles,
		}, nil
	}
	email = strings.TrimSpace(strings.ToLower(email))
	phone = normalizePhone(phone)
	if email == "" && phone == "" {
		return nil, nil
	}
	var where string
	var arg any
	if email != "" {
		where = `lower(COALESCE(email, '')) = $1`
		arg = email
	} else {
		where = `regexp_replace(COALESCE(phone, ''), '[^0-9+]', '', 'g') = $1`
		arg = phone
	}
	row := s.pool.QueryRow(ctx, `
SELECT id, display_name, city, status
FROM users WHERE `+where+` LIMIT 1`, arg)
	var u DirectoryUser
	if err := row.Scan(&u.ID, &u.DisplayName, &u.City, &u.Status); err != nil {
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

func normalizePhone(raw string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(raw) {
		if (r >= '0' && r <= '9') || r == '+' {
			b.WriteRune(r)
		}
	}
	return b.String()
}
