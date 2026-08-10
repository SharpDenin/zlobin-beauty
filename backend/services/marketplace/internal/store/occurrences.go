package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

const occurrenceCols = `id, service_id, master_user_id, branch_id, starts_at, ends_at, timezone,
    capacity, booked_count, status, booking_cutoff_at, title, note, created_at, updated_at`

func (s *Store) CreateOccurrence(ctx context.Context, o domain.ServiceOccurrence) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO service_occurrences(`+occurrenceCols+`)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		o.ID, o.ServiceID, o.MasterUserID, o.BranchID, o.StartsAt, o.EndsAt, o.Timezone,
		o.Capacity, o.BookedCount, o.Status, o.BookingCutoffAt, o.Title, o.Note, o.CreatedAt, o.UpdatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23P01" {
			return apperr.Conflict("occurrence overlaps another active occurrence for this master")
		}
		return err
	}
	return nil
}

func (s *Store) ListOccurrencesByService(ctx context.Context, serviceID uuid.UUID) ([]domain.ServiceOccurrence, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+occurrenceCols+`
FROM service_occurrences
WHERE service_id=$1
ORDER BY starts_at ASC`, serviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanOccurrenceRows(rows)
}

func (s *Store) ListPublicOccurrencesByService(ctx context.Context, serviceID uuid.UUID, now time.Time) ([]domain.ServiceOccurrence, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+occurrenceCols+`
FROM service_occurrences
WHERE service_id=$1
  AND status IN ('scheduled', 'full')
  AND starts_at > $2
ORDER BY starts_at ASC`, serviceID, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanOccurrenceRows(rows)
}

func (s *Store) GetOccurrence(ctx context.Context, id uuid.UUID) (*domain.ServiceOccurrence, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+occurrenceCols+` FROM service_occurrences WHERE id=$1`, id)
	return scanOccurrence(row)
}

func (s *Store) UpdateOccurrence(ctx context.Context, o domain.ServiceOccurrence) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE service_occurrences
SET branch_id=$2, starts_at=$3, ends_at=$4, timezone=$5, capacity=$6, status=$7,
    booking_cutoff_at=$8, title=$9, note=$10, updated_at=$11
WHERE id=$1`, o.ID, o.BranchID, o.StartsAt, o.EndsAt, o.Timezone, o.Capacity, o.Status,
		o.BookingCutoffAt, o.Title, o.Note, o.UpdatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23P01" {
			return apperr.Conflict("occurrence overlaps another active occurrence for this master")
		}
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("occurrence not found")
	}
	return nil
}

func (s *Store) CancelOccurrence(ctx context.Context, id uuid.UUID, at time.Time) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE service_occurrences SET status='cancelled', updated_at=$2 WHERE id=$1 AND status <> 'cancelled'`, id, at)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("occurrence not found")
	}
	return nil
}

func (s *Store) TryBookOccurrence(ctx context.Context, id uuid.UUID) (*domain.ServiceOccurrence, error) {
	row := s.pool.QueryRow(ctx, `
UPDATE service_occurrences
SET booked_count = booked_count + 1,
    status = CASE WHEN booked_count + 1 >= capacity THEN 'full' ELSE status END,
    updated_at = now()
WHERE id = $1
  AND booked_count < capacity
  AND status = 'scheduled'
  AND (booking_cutoff_at IS NULL OR booking_cutoff_at > now())
RETURNING `+occurrenceCols, id)
	o, err := scanOccurrence(row)
	if err != nil {
		return nil, err
	}
	if o == nil {
		return nil, apperr.Conflict("occurrence is full or unavailable")
	}
	return o, nil
}

func (s *Store) ReleaseOccurrenceSlot(ctx context.Context, id uuid.UUID) (*domain.ServiceOccurrence, error) {
	row := s.pool.QueryRow(ctx, `
UPDATE service_occurrences
SET booked_count = booked_count - 1,
    status = CASE
      WHEN status = 'full' AND booked_count - 1 < capacity THEN 'scheduled'
      ELSE status
    END,
    updated_at = now()
WHERE id = $1
  AND booked_count > 0
  AND status IN ('scheduled', 'full')
RETURNING `+occurrenceCols, id)
	o, err := scanOccurrence(row)
	if err != nil {
		return nil, err
	}
	if o == nil {
		return nil, apperr.Conflict("occurrence has no booked slots to release")
	}
	return o, nil
}

func (s *Store) HasOverlappingOccurrence(ctx context.Context, masterUserID uuid.UUID, starts, ends time.Time, excludeID *uuid.UUID) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1 FROM service_occurrences
  WHERE master_user_id=$1
    AND status IN ('scheduled', 'full')
    AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
    AND ($4::uuid IS NULL OR id <> $4)
)`, masterUserID, starts, ends, excludeID).Scan(&ok)
	return ok, err
}

func scanOccurrence(row pgx.Row) (*domain.ServiceOccurrence, error) {
	var o domain.ServiceOccurrence
	if err := row.Scan(&o.ID, &o.ServiceID, &o.MasterUserID, &o.BranchID, &o.StartsAt, &o.EndsAt, &o.Timezone,
		&o.Capacity, &o.BookedCount, &o.Status, &o.BookingCutoffAt, &o.Title, &o.Note, &o.CreatedAt, &o.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &o, nil
}

func scanOccurrenceRows(rows pgx.Rows) ([]domain.ServiceOccurrence, error) {
	var out []domain.ServiceOccurrence
	for rows.Next() {
		var o domain.ServiceOccurrence
		if err := rows.Scan(&o.ID, &o.ServiceID, &o.MasterUserID, &o.BranchID, &o.StartsAt, &o.EndsAt, &o.Timezone,
			&o.Capacity, &o.BookedCount, &o.Status, &o.BookingCutoffAt, &o.Title, &o.Note, &o.CreatedAt, &o.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	if out == nil {
		out = []domain.ServiceOccurrence{}
	}
	return out, rows.Err()
}
