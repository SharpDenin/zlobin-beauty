package store

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/domain"
)

type Store struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

func (s *Store) CreateOrgWithBranchAndOwner(ctx context.Context, org domain.Organization, branch domain.Branch, membership domain.Membership) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `
INSERT INTO organizations(id, name, type, status, created_by, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7)`, org.ID, org.Name, org.Type, org.Status, org.CreatedBy, org.CreatedAt, org.UpdatedAt)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
INSERT INTO branches(id, organization_id, name, city, address_line, timezone, cancel_window_hours, auto_confirm, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		branch.ID, branch.OrganizationID, branch.Name, branch.City, branch.AddressLine, branch.Timezone,
		branch.CancelWindowHours, branch.AutoConfirm, branch.CreatedAt, branch.UpdatedAt)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
INSERT INTO memberships(id, organization_id, user_id, role, status, created_at)
VALUES ($1,$2,$3,$4,$5,$6)`, membership.ID, membership.OrganizationID, membership.UserID, membership.Role, membership.Status, membership.CreatedAt)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) ListMembershipsByUser(ctx context.Context, userID uuid.UUID) ([]domain.Membership, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, organization_id, user_id, role, status, created_at
FROM memberships WHERE user_id=$1 AND status='active' ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Membership
	for rows.Next() {
		var m domain.Membership
		if err := rows.Scan(&m.ID, &m.OrganizationID, &m.UserID, &m.Role, &m.Status, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) GetOrg(ctx context.Context, id uuid.UUID) (*domain.Organization, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, name, type, status, created_by, created_at, updated_at FROM organizations WHERE id=$1`, id)
	var o domain.Organization
	if err := row.Scan(&o.ID, &o.Name, &o.Type, &o.Status, &o.CreatedBy, &o.CreatedAt, &o.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &o, nil
}

func (s *Store) ListBranches(ctx context.Context, orgID uuid.UUID) ([]domain.Branch, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, organization_id, name, city, address_line, timezone, cancel_window_hours, auto_confirm, created_at, updated_at
FROM branches WHERE organization_id=$1 ORDER BY name`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Branch
	for rows.Next() {
		var b domain.Branch
		if err := rows.Scan(&b.ID, &b.OrganizationID, &b.Name, &b.City, &b.AddressLine, &b.Timezone, &b.CancelWindowHours, &b.AutoConfirm, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *Store) HasMembership(ctx context.Context, orgID, userID uuid.UUID, roles ...string) (bool, error) {
	row := s.pool.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1 FROM memberships
  WHERE organization_id=$1 AND user_id=$2 AND status='active' AND role = ANY($3)
)`, orgID, userID, roles)
	var ok bool
	return ok, row.Scan(&ok)
}

func (s *Store) UpsertMembership(ctx context.Context, m domain.Membership) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO memberships(id, organization_id, user_id, role, status, created_at)
VALUES ($1,$2,$3,$4,$5,$6)
ON CONFLICT (organization_id, user_id, role) DO UPDATE SET status=EXCLUDED.status`,
		m.ID, m.OrganizationID, m.UserID, m.Role, m.Status, m.CreatedAt)
	return err
}

func (s *Store) GetBranch(ctx context.Context, id uuid.UUID) (*domain.Branch, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, organization_id, name, city, address_line, timezone, cancel_window_hours, auto_confirm, created_at, updated_at
FROM branches WHERE id=$1`, id)
	var b domain.Branch
	if err := row.Scan(&b.ID, &b.OrganizationID, &b.Name, &b.City, &b.AddressLine, &b.Timezone, &b.CancelWindowHours, &b.AutoConfirm, &b.CreatedAt, &b.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &b, nil
}
