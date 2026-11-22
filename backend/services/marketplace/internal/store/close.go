package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
)

func (s *Store) ListMastersByBranch(ctx context.Context, branchID uuid.UUID) ([]domain.MasterProfile, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+masterCols+`
FROM master_profiles
WHERE branch_id=$1
ORDER BY created_at`, branchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.MasterProfile
	for rows.Next() {
		m, err := scanMaster(rows)
		if err != nil {
			return nil, err
		}
		if m != nil {
			out = append(out, *m)
		}
	}
	return out, rows.Err()
}

func (s *Store) ClearMasterBranch(ctx context.Context, userID, branchID uuid.UUID, at time.Time) error {
	_, err := s.pool.Exec(ctx, `
UPDATE master_profiles
SET branch_id=NULL, updated_at=$3
WHERE user_id=$1 AND branch_id=$2`, userID, branchID, at)
	return err
}

func (s *Store) ClearMasterBranchAddPrivatePractice(ctx context.Context, userID, branchID uuid.UUID, at time.Time) error {
	_, err := s.pool.Exec(ctx, `
UPDATE master_profiles
SET branch_id=NULL,
    work_types = CASE
      WHEN work_types IS NULL OR cardinality(work_types)=0 THEN ARRAY['private_practice']::text[]
      WHEN 'private_practice' = ANY(work_types) THEN work_types
      ELSE array_append(work_types, 'private_practice')
    END,
    work_type = CASE
      WHEN work_type IS NULL OR work_type = '' THEN 'private_practice'
      ELSE work_type
    END,
    updated_at=$3
WHERE user_id=$1 AND branch_id=$2`, userID, branchID, at)
	return err
}

func (s *Store) CancelScheduledOccurrencesByBranch(ctx context.Context, branchID uuid.UUID, at time.Time) (int, error) {
	tag, err := s.pool.Exec(ctx, `
UPDATE service_occurrences
SET status='cancelled', updated_at=$2
WHERE branch_id=$1 AND status='scheduled'`, branchID, at)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}
