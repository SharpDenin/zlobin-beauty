package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type CompletedStats struct {
	TurnoverMinor  int64
	CompletedCount int64
	ClientsWithOne int64
	ClientsWithTwo int64
}

type MasterBookedMinutes struct {
	MasterUserID  uuid.UUID
	BookedMinutes int64
}

// CompletedStatsInRange aggregates completed appointments in [from, to) by starts_at.
func (s *Store) CompletedStatsInRange(ctx context.Context, orgID uuid.UUID, from, to time.Time) (*CompletedStats, error) {
	row := s.pool.QueryRow(ctx, `
SELECT COALESCE(SUM(price_minor), 0)::bigint, COUNT(*)::bigint
FROM appointments
WHERE organization_id = $1
  AND status = 'completed'
  AND starts_at >= $2 AND starts_at < $3`, orgID, from, to)
	var stats CompletedStats
	if err := row.Scan(&stats.TurnoverMinor, &stats.CompletedCount); err != nil {
		return nil, err
	}
	row = s.pool.QueryRow(ctx, `
SELECT
  COUNT(*)::bigint,
  COUNT(*) FILTER (WHERE cnt >= 2)::bigint
FROM (
  SELECT COUNT(*) AS cnt
  FROM appointments
  WHERE organization_id = $1
    AND status = 'completed'
    AND starts_at >= $2 AND starts_at < $3
  GROUP BY client_user_id
) clients`, orgID, from, to)
	if err := row.Scan(&stats.ClientsWithOne, &stats.ClientsWithTwo); err != nil {
		return nil, err
	}
	return &stats, nil
}

// MasterBookedMinutesInRange sums duration_minutes for load-eligible appointments overlapping [from, to).
func (s *Store) MasterBookedMinutesInRange(ctx context.Context, orgID uuid.UUID, from, to time.Time) ([]MasterBookedMinutes, error) {
	rows, err := s.pool.Query(ctx, `
SELECT master_user_id, COALESCE(SUM(duration_minutes), 0)::bigint
FROM appointments
WHERE organization_id = $1
  AND status IN ('confirmed', 'in_progress', 'completed')
  AND starts_at < $3 AND ends_at > $2
GROUP BY master_user_id`, orgID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMasterBooked(rows)
}

// MastersForLoadReport returns distinct masters with completed in [from,to) or active overlapping period.
func (s *Store) MastersForLoadReport(ctx context.Context, orgID uuid.UUID, from, to time.Time) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `
SELECT DISTINCT master_user_id
FROM appointments
WHERE organization_id = $1
  AND (
    (status = 'completed' AND starts_at >= $2 AND starts_at < $3)
    OR (status IN ('confirmed', 'in_progress') AND starts_at < $3 AND ends_at > $2)
  )`, orgID, from, to)
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

// CompletedMasterUserIDs returns masters with completed appointments in [from, to).
func (s *Store) CompletedMasterUserIDs(ctx context.Context, orgID uuid.UUID, from, to time.Time) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `
SELECT DISTINCT master_user_id
FROM appointments
WHERE organization_id = $1
  AND status = 'completed'
  AND starts_at >= $2 AND starts_at < $3`, orgID, from, to)
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

func scanMasterBooked(rows pgx.Rows) ([]MasterBookedMinutes, error) {
	var out []MasterBookedMinutes
	for rows.Next() {
		var m MasterBookedMinutes
		if err := rows.Scan(&m.MasterUserID, &m.BookedMinutes); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
