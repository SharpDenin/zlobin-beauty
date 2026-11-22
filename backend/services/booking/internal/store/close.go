package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
)

func (s *Store) CountFutureCancellableByBranch(ctx context.Context, branchID uuid.UUID, now time.Time) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*)::int FROM appointments
WHERE branch_id=$1
  AND status IN ($2,$3)
  AND starts_at > $4`,
		branchID, domain.StatusPendingConfirmation, domain.StatusConfirmed, now).Scan(&n)
	return n, err
}

func (s *Store) ListFutureCancellableByBranch(ctx context.Context, branchID uuid.UUID, now time.Time) ([]domain.Appointment, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+appointmentCols+`
FROM appointments
WHERE branch_id=$1
  AND status IN ($2,$3)
  AND starts_at > $4
ORDER BY starts_at`,
		branchID, domain.StatusPendingConfirmation, domain.StatusConfirmed, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAppointments(rows)
}

// ListBranchCloseCancelledForNotify returns appointments cancelled due to branch close
// so resume can ensure notifications even when status transition already happened.
func (s *Store) ListBranchCloseCancelledForNotify(ctx context.Context, branchID uuid.UUID, reason string) ([]domain.Appointment, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+appointmentCols+`
FROM appointments
WHERE branch_id=$1
  AND status=$2
  AND COALESCE(cancel_reason, '')=$3
ORDER BY starts_at`,
		branchID, domain.StatusCancelledBySalon, reason)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAppointments(rows)
}

func (s *Store) CountBranchLeasesByStatus(ctx context.Context, branchID uuid.UUID, status string) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*)::int
FROM chair_leases l
JOIN salon_chairs c ON c.id = l.chair_id
WHERE c.branch_id=$1 AND l.status=$2`, branchID, status).Scan(&n)
	return n, err
}

func (s *Store) DeleteWorkIntervalsByBranch(ctx context.Context, branchID uuid.UUID) (int, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM master_work_mode_intervals WHERE branch_id=$1`, branchID)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

func (s *Store) DeactivateChairsByBranch(ctx context.Context, branchID uuid.UUID, now time.Time) (int, error) {
	tag, err := s.pool.Exec(ctx, `
UPDATE salon_chairs
SET status=$2, listed_for_rent=FALSE, updated_at=$3
WHERE branch_id=$1 AND (status <> $2 OR listed_for_rent = TRUE)`,
		branchID, domain.ChairStatusInactive, now)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

func (s *Store) ListMasterUserIDsByBranchIntervals(ctx context.Context, branchID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `
SELECT DISTINCT master_user_id FROM master_work_mode_intervals WHERE branch_id=$1`, branchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (s *Store) HasWorkIntervalsInOtherBranches(ctx context.Context, masterUserID, orgID, closingBranchID uuid.UUID) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1 FROM master_work_mode_intervals
  WHERE master_user_id=$1
    AND organization_id=$2
    AND branch_id IS NOT NULL
    AND branch_id <> $3
)`, masterUserID, orgID, closingBranchID).Scan(&exists)
	return exists, err
}

func (s *Store) HasFutureAppointmentsInOtherBranches(ctx context.Context, masterUserID, orgID, closingBranchID uuid.UUID, now time.Time) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1 FROM appointments
  WHERE master_user_id=$1
    AND organization_id=$2
    AND branch_id <> $3
    AND starts_at > $4
    AND status IN ($5,$6,$7)
)`, masterUserID, orgID, closingBranchID, now,
		domain.StatusPendingConfirmation, domain.StatusConfirmed, domain.StatusInProgress).Scan(&exists)
	return exists, err
}
