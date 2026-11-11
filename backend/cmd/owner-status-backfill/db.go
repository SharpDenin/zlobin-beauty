package main

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func openPool(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 4
	return pgxpool.NewWithConfig(ctx, cfg)
}

// ListMasterOwnerRows page-scans master_profiles by user_id for resume-safe batches.
// Cursor is exclusive: rows with user_id > afterUserID. On mid-batch failure, resume
// with the previous batch's last user_id so the failed batch is fully re-scanned
// (idempotent for already-applied rows).
func ListMasterOwnerRows(ctx context.Context, pool *pgxpool.Pool, afterUserID uuid.UUID, limit int) ([]MasterOwnerRow, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := pool.Query(ctx, `
SELECT id, user_id, COALESCE(owner_status, 'active'), published
FROM master_profiles
WHERE user_id > $1
ORDER BY user_id ASC
LIMIT $2`, afterUserID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MasterOwnerRow
	for rows.Next() {
		var r MasterOwnerRow
		if err := rows.Scan(&r.ProfileID, &r.UserID, &r.OwnerStatus, &r.Published); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func GetMasterOwnerRow(ctx context.Context, pool *pgxpool.Pool, profileID uuid.UUID) (*MasterOwnerRow, error) {
	var r MasterOwnerRow
	err := pool.QueryRow(ctx, `
SELECT id, user_id, COALESCE(owner_status, 'active'), published
FROM master_profiles WHERE id=$1`, profileID).Scan(&r.ProfileID, &r.UserID, &r.OwnerStatus, &r.Published)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

// FetchIdentityStatuses loads statuses for the given user ids from Identity DB.
func FetchIdentityStatuses(ctx context.Context, pool *pgxpool.Pool, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	out := make(map[uuid.UUID]string, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := pool.Query(ctx, `
SELECT id, status
FROM users
WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var status string
		if err := rows.Scan(&id, &status); err != nil {
			return nil, err
		}
		out[id] = status
	}
	return out, rows.Err()
}

// ApplyResult describes a compare-and-set owner_status write.
type ApplyResult struct {
	Applied            bool
	SkippedConcurrent  bool
	SkippedAlreadyDone bool
}

// ApplyChangeCAS writes owner_status only if marketplace still has FromStatus
// (or deleted+published for ForceUnpub). Prevents clobbering a newer block/delete.
func ApplyChangeCAS(ctx context.Context, pool *pgxpool.Pool, c Change, at time.Time) (ApplyResult, error) {
	var tag interface{ RowsAffected() int64 }
	var err error
	if c.ForceUnpub && c.FromStatus == "deleted" && c.ToStatus == "deleted" {
		tag, err = pool.Exec(ctx, `
UPDATE master_profiles
SET published = FALSE, updated_at = $2
WHERE id = $1 AND user_id = $3 AND owner_status = 'deleted' AND published = TRUE`,
			c.ProfileID, at, c.UserID)
	} else {
		tag, err = pool.Exec(ctx, `
UPDATE master_profiles
SET owner_status = $2,
    published = CASE WHEN $2 = 'deleted' THEN FALSE ELSE published END,
    updated_at = $3
WHERE id = $1 AND user_id = $4 AND owner_status = $5`,
			c.ProfileID, c.ToStatus, at, c.UserID, c.FromStatus)
	}
	if err != nil {
		return ApplyResult{}, err
	}
	if tag.RowsAffected() == 0 {
		return ApplyResult{SkippedConcurrent: true}, nil
	}
	return ApplyResult{Applied: true}, nil
}

// ApplyChangeFresh re-reads Identity + marketplace, rebuilds the change, then CAS-applies.
// Stale batch plans cannot overwrite a newer admin/delete status.
func ApplyChangeFresh(ctx context.Context, mp, id *pgxpool.Pool, planned Change, at time.Time) (ApplyResult, error) {
	row, err := GetMasterOwnerRow(ctx, mp, planned.ProfileID)
	if err != nil {
		return ApplyResult{}, err
	}
	if row == nil {
		return ApplyResult{}, fmt.Errorf("profile %s disappeared", planned.ProfileID)
	}
	by, err := FetchIdentityStatuses(ctx, id, []uuid.UUID{row.UserID})
	if err != nil {
		return ApplyResult{}, err
	}
	plan := BuildPlan([]MasterOwnerRow{*row}, by)
	if err := PlanBlocksApply(plan); err != nil {
		return ApplyResult{}, err
	}
	if len(plan.Changes) == 0 {
		return ApplyResult{SkippedAlreadyDone: true}, nil
	}
	return ApplyChangeCAS(ctx, mp, plan.Changes[0], at)
}

// NextResumeAfter returns the exclusive cursor to store after a fully successful batch.
func NextResumeAfter(batch []MasterOwnerRow) uuid.UUID {
	if len(batch) == 0 {
		return uuid.Nil
	}
	return batch[len(batch)-1].UserID
}

// ResumeAfterOnFailure keeps the previous cursor so the failed batch is reprocessed.
func ResumeAfterOnFailure(prevCursor uuid.UUID) uuid.UUID {
	return prevCursor
}
