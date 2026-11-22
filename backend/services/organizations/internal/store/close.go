package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/domain"
)

func (s *Store) CountActiveBranches(ctx context.Context, orgID uuid.UUID) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*)::int FROM branches WHERE organization_id=$1 AND active=TRUE`, orgID).Scan(&n)
	return n, err
}

func (s *Store) InsertBranchCloseJob(ctx context.Context, job domain.BranchCloseJob) error {
	blockers := job.BlockersJSON
	if len(blockers) == 0 {
		blockers = []byte("[]")
	}
	result := job.ResultJSON
	if len(result) == 0 {
		result = []byte("{}")
	}
	_, err := s.pool.Exec(ctx, `
INSERT INTO branch_close_jobs(
  id, branch_id, organization_id, actor_user_id, status, contact_phone, contact_source,
  future_appointments, masters_affected, last_active_branch, org_unpublished,
  error_message, blockers_json, result_json, created_at, updated_at, completed_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17)`,
		job.ID, job.BranchID, job.OrganizationID, job.ActorUserID, job.Status, job.ContactPhone, job.ContactSource,
		job.FutureAppointments, job.MastersAffected, job.LastActiveBranch, job.OrgUnpublished,
		job.ErrorMessage, string(blockers), string(result), job.CreatedAt, job.UpdatedAt, job.CompletedAt,
	)
	return err
}

func (s *Store) UpdateBranchCloseJob(ctx context.Context, job domain.BranchCloseJob) error {
	blockers := job.BlockersJSON
	if len(blockers) == 0 {
		blockers = []byte("[]")
	}
	result := job.ResultJSON
	if len(result) == 0 {
		result = []byte("{}")
	}
	tag, err := s.pool.Exec(ctx, `
UPDATE branch_close_jobs SET
  status=$2, contact_phone=$3, contact_source=$4,
  future_appointments=$5, masters_affected=$6, last_active_branch=$7, org_unpublished=$8,
  error_message=$9, blockers_json=$10::jsonb, result_json=$11::jsonb,
  updated_at=$12, completed_at=$13
WHERE id=$1`,
		job.ID, job.Status, job.ContactPhone, job.ContactSource,
		job.FutureAppointments, job.MastersAffected, job.LastActiveBranch, job.OrgUnpublished,
		job.ErrorMessage, string(blockers), string(result), job.UpdatedAt, job.CompletedAt,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) GetBranchCloseJob(ctx context.Context, id uuid.UUID) (*domain.BranchCloseJob, error) {
	return scanCloseJob(s.pool.QueryRow(ctx, `
SELECT id, branch_id, organization_id, actor_user_id, status, contact_phone, contact_source,
  future_appointments, masters_affected, last_active_branch, org_unpublished,
  error_message, blockers_json, result_json, created_at, updated_at, completed_at
FROM branch_close_jobs WHERE id=$1`, id))
}

func (s *Store) LatestBranchCloseJob(ctx context.Context, branchID uuid.UUID) (*domain.BranchCloseJob, error) {
	return scanCloseJob(s.pool.QueryRow(ctx, `
SELECT id, branch_id, organization_id, actor_user_id, status, contact_phone, contact_source,
  future_appointments, masters_affected, last_active_branch, org_unpublished,
  error_message, blockers_json, result_json, created_at, updated_at, completed_at
FROM branch_close_jobs WHERE branch_id=$1
ORDER BY created_at DESC LIMIT 1`, branchID))
}

func (s *Store) RunningBranchCloseJob(ctx context.Context, branchID uuid.UUID) (*domain.BranchCloseJob, error) {
	return scanCloseJob(s.pool.QueryRow(ctx, `
SELECT id, branch_id, organization_id, actor_user_id, status, contact_phone, contact_source,
  future_appointments, masters_affected, last_active_branch, org_unpublished,
  error_message, blockers_json, result_json, created_at, updated_at, completed_at
FROM branch_close_jobs WHERE branch_id=$1 AND status='running'
LIMIT 1`, branchID))
}

func scanCloseJob(row pgx.Row) (*domain.BranchCloseJob, error) {
	var j domain.BranchCloseJob
	var blockers, result []byte
	err := row.Scan(
		&j.ID, &j.BranchID, &j.OrganizationID, &j.ActorUserID, &j.Status, &j.ContactPhone, &j.ContactSource,
		&j.FutureAppointments, &j.MastersAffected, &j.LastActiveBranch, &j.OrgUnpublished,
		&j.ErrorMessage, &blockers, &result, &j.CreatedAt, &j.UpdatedAt, &j.CompletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if len(blockers) == 0 {
		blockers = []byte("[]")
	}
	if len(result) == 0 {
		result = []byte("{}")
	}
	j.BlockersJSON = json.RawMessage(blockers)
	j.ResultJSON = json.RawMessage(result)
	return &j, nil
}

// TryBeginBranchClose sets active=false and published=false if still active.
// Returns whether this call performed the transition (true) or branch was already inactive (false).
func (s *Store) TryBeginBranchClose(ctx context.Context, branchID uuid.UUID, at time.Time) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
UPDATE branches SET active=FALSE, published=FALSE, updated_at=$2
WHERE id=$1 AND active=TRUE`, branchID, at)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
