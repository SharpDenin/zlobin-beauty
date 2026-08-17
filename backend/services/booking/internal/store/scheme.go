package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type SchemeComponent struct {
	Name       string
	Brand      string
	Qty        string
	Unit       string
	Proportion string
	Notes      string
}

type ServiceScheme struct {
	AppointmentID  uuid.UUID
	Technique      string
	Notes          string
	CategoryFields json.RawMessage
	Skipped        bool
	CreatedBy      uuid.UUID
	Components     []SchemeComponent
}

func (s *Store) UpsertServiceScheme(ctx context.Context, in ServiceScheme, now time.Time) error {
	fields := in.CategoryFields
	if len(fields) == 0 {
		fields = []byte("{}")
	}
	_, err := s.pool.Exec(ctx, `
INSERT INTO appointment_service_schemes(appointment_id, technique, notes, category_fields, skipped, created_by, created_at, updated_at)
VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$7)
ON CONFLICT (appointment_id) DO UPDATE SET
  technique=EXCLUDED.technique, notes=EXCLUDED.notes, category_fields=EXCLUDED.category_fields,
  skipped=EXCLUDED.skipped, updated_at=EXCLUDED.updated_at`,
		in.AppointmentID, in.Technique, in.Notes, string(fields), in.Skipped, in.CreatedBy, now)
	if err != nil {
		return err
	}
	if _, err := s.pool.Exec(ctx, `DELETE FROM appointment_scheme_components WHERE appointment_id=$1`, in.AppointmentID); err != nil {
		return err
	}
	for i, c := range in.Components {
		if _, err := s.pool.Exec(ctx, `
INSERT INTO appointment_scheme_components(id, appointment_id, name, brand, qty, unit, proportion, notes, sort_order)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			ids.New(), in.AppointmentID, c.Name, c.Brand, c.Qty, c.Unit, c.Proportion, c.Notes, i); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) GetServiceScheme(ctx context.Context, appointmentID uuid.UUID) (*ServiceScheme, error) {
	var out ServiceScheme
	out.AppointmentID = appointmentID
	err := s.pool.QueryRow(ctx, `
SELECT technique, notes, category_fields, skipped, created_by
FROM appointment_service_schemes WHERE appointment_id=$1`, appointmentID).Scan(
		&out.Technique, &out.Notes, &out.CategoryFields, &out.Skipped, &out.CreatedBy)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `
SELECT name, brand, qty, unit, proportion, notes
FROM appointment_scheme_components WHERE appointment_id=$1 ORDER BY sort_order`, appointmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var c SchemeComponent
		if err := rows.Scan(&c.Name, &c.Brand, &c.Qty, &c.Unit, &c.Proportion, &c.Notes); err != nil {
			return nil, err
		}
		out.Components = append(out.Components, c)
	}
	return &out, rows.Err()
}

type PlannerBlock struct {
	ID             uuid.UUID
	OwnerUserID    uuid.UUID
	OrganizationID *uuid.UUID
	Title          string
	Category       string
	StartsAt       time.Time
	EndsAt         time.Time
	Timezone       string
	Color          string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

func (s *Store) ListPlannerBlocks(ctx context.Context, owner uuid.UUID, from, to time.Time) ([]PlannerBlock, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, owner_user_id, organization_id, title, category, starts_at, ends_at, timezone, color, created_at, updated_at
FROM planner_blocks
WHERE owner_user_id=$1 AND starts_at < $3 AND ends_at > $2
ORDER BY starts_at`, owner, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PlannerBlock
	for rows.Next() {
		var b PlannerBlock
		if err := rows.Scan(&b.ID, &b.OwnerUserID, &b.OrganizationID, &b.Title, &b.Category, &b.StartsAt, &b.EndsAt, &b.Timezone, &b.Color, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *Store) ListPlannerBlocksForOrg(ctx context.Context, orgID, viewer uuid.UUID, from, to time.Time) ([]PlannerBlock, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, owner_user_id, organization_id, title, category, starts_at, ends_at, timezone, color, created_at, updated_at
FROM planner_blocks
WHERE starts_at < $3 AND ends_at > $2
  AND (organization_id=$1 OR owner_user_id=$4)
ORDER BY starts_at`, orgID, from, to, viewer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PlannerBlock
	for rows.Next() {
		var b PlannerBlock
		if err := rows.Scan(&b.ID, &b.OwnerUserID, &b.OrganizationID, &b.Title, &b.Category, &b.StartsAt, &b.EndsAt, &b.Timezone, &b.Color, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *Store) PlannerBlockOverlaps(ctx context.Context, owner uuid.UUID, excludeID uuid.UUID, starts, ends time.Time) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `
SELECT EXISTS (
  SELECT 1 FROM planner_blocks
  WHERE owner_user_id=$1
    AND id <> $2
    AND starts_at < $4
    AND ends_at > $3
)`, owner, excludeID, starts, ends).Scan(&exists)
	return exists, err
}

func (s *Store) InsertPlannerBlock(ctx context.Context, b PlannerBlock) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO planner_blocks(id, owner_user_id, organization_id, title, category, starts_at, ends_at, timezone, color, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		b.ID, b.OwnerUserID, b.OrganizationID, b.Title, b.Category, b.StartsAt, b.EndsAt, b.Timezone, b.Color, b.CreatedAt, b.UpdatedAt)
	return err
}

func (s *Store) GetPlannerBlock(ctx context.Context, id uuid.UUID) (*PlannerBlock, error) {
	var b PlannerBlock
	err := s.pool.QueryRow(ctx, `
SELECT id, owner_user_id, organization_id, title, category, starts_at, ends_at, timezone, color, created_at, updated_at
FROM planner_blocks WHERE id=$1`, id).Scan(
		&b.ID, &b.OwnerUserID, &b.OrganizationID, &b.Title, &b.Category, &b.StartsAt, &b.EndsAt, &b.Timezone, &b.Color, &b.CreatedAt, &b.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &b, nil
}

func (s *Store) UpdatePlannerBlock(ctx context.Context, b PlannerBlock) error {
	_, err := s.pool.Exec(ctx, `
UPDATE planner_blocks
SET title=$2, category=$3, starts_at=$4, ends_at=$5, color=$6, updated_at=$7
WHERE id=$1`, b.ID, b.Title, b.Category, b.StartsAt, b.EndsAt, b.Color, b.UpdatedAt)
	return err
}

func (s *Store) UpdatePlannerBlockTimes(ctx context.Context, id uuid.UUID, starts, ends time.Time, now time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE planner_blocks SET starts_at=$2, ends_at=$3, updated_at=$4 WHERE id=$1`, id, starts, ends, now)
	return err
}

func (s *Store) DeletePlannerBlock(ctx context.Context, id uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM planner_blocks WHERE id=$1`, id)
	return err
}
