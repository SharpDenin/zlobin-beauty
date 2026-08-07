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

const orgCols = `id, name, description, type, status, published, created_by, created_at, updated_at`
const branchCols = `id, organization_id, name, city, address_line, phone, timezone, cancel_window_hours, auto_confirm, published, created_at, updated_at`

func scanOrg(row pgx.Row) (*domain.Organization, error) {
	var o domain.Organization
	if err := row.Scan(&o.ID, &o.Name, &o.Description, &o.Type, &o.Status, &o.Published, &o.CreatedBy, &o.CreatedAt, &o.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &o, nil
}

func scanBranch(row pgx.Row) (*domain.Branch, error) {
	var b domain.Branch
	if err := row.Scan(&b.ID, &b.OrganizationID, &b.Name, &b.City, &b.AddressLine, &b.Phone, &b.Timezone,
		&b.CancelWindowHours, &b.AutoConfirm, &b.Published, &b.CreatedAt, &b.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &b, nil
}

func (s *Store) CreateOrgWithBranchAndOwner(ctx context.Context, org domain.Organization, branch domain.Branch, membership domain.Membership) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `
INSERT INTO organizations(id, name, description, type, status, published, created_by, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, org.ID, org.Name, org.Description, org.Type, org.Status, org.Published, org.CreatedBy, org.CreatedAt, org.UpdatedAt)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
INSERT INTO branches(id, organization_id, name, city, address_line, phone, timezone, cancel_window_hours, auto_confirm, published, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		branch.ID, branch.OrganizationID, branch.Name, branch.City, branch.AddressLine, branch.Phone, branch.Timezone,
		branch.CancelWindowHours, branch.AutoConfirm, branch.Published, branch.CreatedAt, branch.UpdatedAt)
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
	return scanOrg(s.pool.QueryRow(ctx, `SELECT `+orgCols+` FROM organizations WHERE id=$1`, id))
}

func (s *Store) UpdateOrg(ctx context.Context, org domain.Organization) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE organizations SET name=$2, description=$3, published=$4, updated_at=$5 WHERE id=$1`,
		org.ID, org.Name, org.Description, org.Published, org.UpdatedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) ListBranches(ctx context.Context, orgID uuid.UUID) ([]domain.Branch, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+branchCols+`
FROM branches WHERE organization_id=$1 ORDER BY name`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Branch
	for rows.Next() {
		b, err := scanBranch(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *b)
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
	return scanBranch(s.pool.QueryRow(ctx, `SELECT `+branchCols+` FROM branches WHERE id=$1`, id))
}

func (s *Store) UpdateBranch(ctx context.Context, branch domain.Branch) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE branches SET name=$2, city=$3, address_line=$4, phone=$5, timezone=$6, published=$7, updated_at=$8 WHERE id=$1`,
		branch.ID, branch.Name, branch.City, branch.AddressLine, branch.Phone, branch.Timezone, branch.Published, branch.UpdatedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// --- branch photos ---

const branchPhotoCols = `id, branch_id, media_id, sort_order, created_at`

func (s *Store) ListBranchPhotos(ctx context.Context, branchID uuid.UUID) ([]domain.BranchPhoto, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+branchPhotoCols+` FROM branch_photos
WHERE branch_id=$1 ORDER BY sort_order ASC, created_at ASC`, branchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.BranchPhoto
	for rows.Next() {
		var p domain.BranchPhoto
		if err := rows.Scan(&p.ID, &p.BranchID, &p.MediaID, &p.SortOrder, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) CreateBranchPhoto(ctx context.Context, p domain.BranchPhoto) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO branch_photos(id, branch_id, media_id, sort_order, created_at)
VALUES ($1,$2,$3,$4,$5)`,
		p.ID, p.BranchID, p.MediaID, p.SortOrder, p.CreatedAt)
	return err
}

func (s *Store) GetBranchPhoto(ctx context.Context, id uuid.UUID) (*domain.BranchPhoto, error) {
	var p domain.BranchPhoto
	err := s.pool.QueryRow(ctx, `SELECT `+branchPhotoCols+` FROM branch_photos WHERE id=$1`, id).
		Scan(&p.ID, &p.BranchID, &p.MediaID, &p.SortOrder, &p.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

func (s *Store) DeleteBranchPhoto(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM branch_photos WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}
