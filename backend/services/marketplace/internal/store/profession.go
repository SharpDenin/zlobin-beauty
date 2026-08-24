package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
)

func (s *Store) ListActiveProfessionTypes(ctx context.Context) ([]domain.ProfessionType, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, slug, name, is_active, created_at, updated_at
FROM master_types
WHERE is_active = TRUE
ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ProfessionType
	for rows.Next() {
		var t domain.ProfessionType
		if err := rows.Scan(&t.ID, &t.Slug, &t.Name, &t.IsActive, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	if out == nil {
		out = []domain.ProfessionType{}
	}
	return out, rows.Err()
}

func (s *Store) GetProfessionTypesByIDs(ctx context.Context, ids []uuid.UUID) ([]domain.ProfessionType, error) {
	if len(ids) == 0 {
		return []domain.ProfessionType{}, nil
	}
	rows, err := s.pool.Query(ctx, `
SELECT id, slug, name, is_active, created_at, updated_at
FROM master_types
WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ProfessionType
	for rows.Next() {
		var t domain.ProfessionType
		if err := rows.Scan(&t.ID, &t.Slug, &t.Name, &t.IsActive, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	if out == nil {
		out = []domain.ProfessionType{}
	}
	return out, rows.Err()
}

func (s *Store) ListMasterProfessionTypes(ctx context.Context, masterUserID uuid.UUID) ([]domain.ProfessionType, error) {
	rows, err := s.pool.Query(ctx, `
SELECT mt.id, mt.slug, mt.name, mt.is_active, mpt.locked_at, mt.created_at, mt.updated_at
FROM master_profile_types mpt
JOIN master_types mt ON mt.id = mpt.profession_type_id
WHERE mpt.master_user_id = $1
ORDER BY mt.name`, masterUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ProfessionType
	for rows.Next() {
		var t domain.ProfessionType
		if err := rows.Scan(&t.ID, &t.Slug, &t.Name, &t.IsActive, &t.LockedAt, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	if out == nil {
		out = []domain.ProfessionType{}
	}
	return out, rows.Err()
}

func (s *Store) ListProfessionTypesForUsers(ctx context.Context, userIDs []uuid.UUID) (map[uuid.UUID][]domain.ProfessionType, error) {
	out := map[uuid.UUID][]domain.ProfessionType{}
	if len(userIDs) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx, `
SELECT mpt.master_user_id, mt.id, mt.slug, mt.name, mt.is_active, mpt.locked_at, mt.created_at, mt.updated_at
FROM master_profile_types mpt
JOIN master_types mt ON mt.id = mpt.profession_type_id
WHERE mpt.master_user_id = ANY($1)
ORDER BY mt.name`, userIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var userID uuid.UUID
		var t domain.ProfessionType
		if err := rows.Scan(&userID, &t.ID, &t.Slug, &t.Name, &t.IsActive, &t.LockedAt, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		out[userID] = append(out[userID], t)
	}
	return out, rows.Err()
}

func (s *Store) ReplaceMasterProfessionTypes(ctx context.Context, masterUserID uuid.UUID, keepIDs []uuid.UUID, lock bool, now time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `DELETE FROM master_profile_types WHERE master_user_id=$1 AND NOT (profession_type_id = ANY($2))`, masterUserID, keepIDs); err != nil {
		return err
	}
	for _, id := range keepIDs {
		var lockedAt *time.Time
		if lock {
			lockedAt = &now
		}
		if _, err := tx.Exec(ctx, `
INSERT INTO master_profile_types (id, master_user_id, profession_type_id, locked_at, created_at)
VALUES ($1,$2,$3,$4,$5)
ON CONFLICT (master_user_id, profession_type_id) DO UPDATE SET
  locked_at = CASE
    WHEN master_profile_types.locked_at IS NOT NULL THEN master_profile_types.locked_at
    ELSE EXCLUDED.locked_at
  END`, uuid.New(), masterUserID, id, lockedAt, now); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) CountMasterServices(ctx context.Context, masterID uuid.UUID) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM master_services WHERE master_id=$1`, masterID).Scan(&n)
	return n, err
}
