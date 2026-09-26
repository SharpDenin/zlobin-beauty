package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

const (
	intervalOverlapMsg = "Интервалы режимов работы не должны пересекаться"
	chairBusyMsg       = "Это кресло уже занято в выбранный период"
	leaseOverlapMsg    = "Это кресло уже сдано в аренду на пересекающийся период"
)

func mapExclusion(err error, constraint, msg string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && (pgErr.Code == pgerrcode.ExclusionViolation || pgErr.Code == "23P01") {
		if constraint == "" || pgErr.ConstraintName == constraint || pgErr.ConstraintName == "" {
			return apperr.Conflict(msg)
		}
		return apperr.Conflict(msg)
	}
	return err
}

func (s *Store) ListGeoCities(ctx context.Context) ([]domain.GeoCity, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, name, timezone FROM geo_cities ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.GeoCity
	for rows.Next() {
		var c domain.GeoCity
		if err := rows.Scan(&c.ID, &c.Name, &c.Timezone); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	if out == nil {
		out = []domain.GeoCity{}
	}
	return out, rows.Err()
}

func (s *Store) GetGeoCity(ctx context.Context, id uuid.UUID) (*domain.GeoCity, error) {
	var c domain.GeoCity
	err := s.pool.QueryRow(ctx, `SELECT id, name, timezone FROM geo_cities WHERE id=$1`, id).Scan(&c.ID, &c.Name, &c.Timezone)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *Store) ListGeoDistricts(ctx context.Context, cityID uuid.UUID) ([]domain.GeoDistrict, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, city_id, name FROM geo_districts WHERE city_id=$1 ORDER BY name`, cityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.GeoDistrict
	for rows.Next() {
		var d domain.GeoDistrict
		if err := rows.Scan(&d.ID, &d.CityID, &d.Name); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	if out == nil {
		out = []domain.GeoDistrict{}
	}
	return out, rows.Err()
}

func (s *Store) GetGeoDistrict(ctx context.Context, id uuid.UUID) (*domain.GeoDistrict, error) {
	var d domain.GeoDistrict
	err := s.pool.QueryRow(ctx, `SELECT id, city_id, name FROM geo_districts WHERE id=$1`, id).Scan(&d.ID, &d.CityID, &d.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func (s *Store) CreateChair(ctx context.Context, c domain.SalonChair) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO salon_chairs(id, organization_id, branch_id, name, description, status, listed_for_rent, rent_terms, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		c.ID, c.OrganizationID, c.BranchID, c.Name, c.Description, c.Status, c.ListedForRent, c.RentNote, c.CreatedAt, c.UpdatedAt)
	return err
}

func (s *Store) UpdateChair(ctx context.Context, c domain.SalonChair) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE salon_chairs
SET name=$2, description=$3, status=$4, listed_for_rent=$5, rent_terms=$6, updated_at=$7
WHERE id=$1`, c.ID, c.Name, c.Description, c.Status, c.ListedForRent, c.RentNote, c.UpdatedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("chair not found")
	}
	return nil
}

func (s *Store) GetChair(ctx context.Context, id uuid.UUID) (*domain.SalonChair, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, organization_id, branch_id, name, description, status, listed_for_rent, rent_terms, created_at, updated_at
FROM salon_chairs WHERE id=$1`, id)
	return scanChair(row)
}

func (s *Store) ListOrgChairs(ctx context.Context, orgID uuid.UUID) ([]domain.SalonChair, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, organization_id, branch_id, name, description, status, listed_for_rent, rent_terms, created_at, updated_at
FROM salon_chairs WHERE organization_id=$1 ORDER BY name`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanChairs(rows)
}

func (s *Store) ListMarketplaceChairs(ctx context.Context) ([]domain.SalonChair, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, organization_id, branch_id, name, description, status, listed_for_rent, rent_terms, created_at, updated_at
FROM salon_chairs
WHERE listed_for_rent AND status='active'
ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanChairs(rows)
}

func (s *Store) ListChairsByIDs(ctx context.Context, ids []uuid.UUID) ([]domain.SalonChair, error) {
	if len(ids) == 0 {
		return []domain.SalonChair{}, nil
	}
	rows, err := s.pool.Query(ctx, `
SELECT id, organization_id, branch_id, name, description, status, listed_for_rent, rent_terms, created_at, updated_at
FROM salon_chairs WHERE id = ANY($1)
ORDER BY name`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanChairs(rows)
}

func scanChair(row pgx.Row) (*domain.SalonChair, error) {
	var c domain.SalonChair
	err := row.Scan(&c.ID, &c.OrganizationID, &c.BranchID, &c.Name, &c.Description, &c.Status, &c.ListedForRent, &c.RentNote, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func scanChairs(rows pgx.Rows) ([]domain.SalonChair, error) {
	var out []domain.SalonChair
	for rows.Next() {
		c, err := scanChair(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	if out == nil {
		out = []domain.SalonChair{}
	}
	return out, rows.Err()
}

func (s *Store) ExpireLeases(ctx context.Context, now time.Time) error {
	_, err := s.pool.Exec(ctx, `
UPDATE chair_leases SET status='expired', updated_at=$1
WHERE status='active' AND ends_at <= $1`, now)
	return err
}

func (s *Store) CreateLease(ctx context.Context, l domain.ChairLease) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO chair_leases(id, chair_id, organization_id, renter_user_id, starts_at, ends_at, status, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		l.ID, l.ChairID, l.OrganizationID, l.RenterUserID, l.StartsAt, l.EndsAt, l.Status, l.CreatedAt, l.UpdatedAt)
	return mapExclusion(err, "chair_leases_no_overlap", leaseOverlapMsg)
}

func (s *Store) GetLease(ctx context.Context, id uuid.UUID) (*domain.ChairLease, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, chair_id, organization_id, renter_user_id, starts_at, ends_at, status, created_at, updated_at
FROM chair_leases WHERE id=$1`, id)
	return scanLease(row)
}

func (s *Store) UpdateLeaseStatus(ctx context.Context, id uuid.UUID, status string, now time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE chair_leases SET status=$2, updated_at=$3 WHERE id=$1`, id, status, now)
	return mapExclusion(err, "chair_leases_no_overlap", leaseOverlapMsg)
}

func (s *Store) ListLeasesForChair(ctx context.Context, chairID uuid.UUID) ([]domain.ChairLease, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, chair_id, organization_id, renter_user_id, starts_at, ends_at, status, created_at, updated_at
FROM chair_leases WHERE chair_id=$1 ORDER BY created_at DESC`, chairID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLeases(rows)
}

func (s *Store) ListLeasesForRenter(ctx context.Context, renter uuid.UUID) ([]domain.ChairLease, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, chair_id, organization_id, renter_user_id, starts_at, ends_at, status, created_at, updated_at
FROM chair_leases WHERE renter_user_id=$1 ORDER BY starts_at DESC`, renter)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLeases(rows)
}

func (s *Store) ListOrgLeases(ctx context.Context, orgID uuid.UUID) ([]domain.ChairLease, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, chair_id, organization_id, renter_user_id, starts_at, ends_at, status, created_at, updated_at
FROM chair_leases WHERE organization_id=$1 ORDER BY created_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLeases(rows)
}

func (s *Store) ActiveLeaseCovering(ctx context.Context, chairID, renter uuid.UUID, start, end time.Time) (*domain.ChairLease, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, chair_id, organization_id, renter_user_id, starts_at, ends_at, status, created_at, updated_at
FROM chair_leases
WHERE chair_id=$1 AND renter_user_id=$2 AND status='active'
  AND starts_at <= $3 AND ends_at >= $4
ORDER BY starts_at
LIMIT 1`, chairID, renter, start, end)
	return scanLease(row)
}

func (s *Store) HasActiveLeaseOverlap(ctx context.Context, chairID uuid.UUID, start, end time.Time, exclude uuid.UUID) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1 FROM chair_leases
  WHERE chair_id=$1 AND status='active' AND id <> $4
    AND starts_at < $3 AND ends_at > $2
)`, chairID, start, end, exclude).Scan(&exists)
	return exists, err
}

func scanLease(row pgx.Row) (*domain.ChairLease, error) {
	var l domain.ChairLease
	err := row.Scan(&l.ID, &l.ChairID, &l.OrganizationID, &l.RenterUserID, &l.StartsAt, &l.EndsAt, &l.Status, &l.CreatedAt, &l.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &l, nil
}

func scanLeases(rows pgx.Rows) ([]domain.ChairLease, error) {
	var out []domain.ChairLease
	for rows.Next() {
		l, err := scanLease(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *l)
	}
	if out == nil {
		out = []domain.ChairLease{}
	}
	return out, rows.Err()
}

const intervalCols = `
id, master_user_id, mode, starts_at, ends_at, timezone, organization_id, branch_id, chair_id,
percentage_rate, city_id, created_at, updated_at`

func (s *Store) CreateWorkModeInterval(ctx context.Context, in domain.WorkModeInterval, districtIDs []uuid.UUID) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if in.ID == uuid.Nil {
		in.ID = ids.New()
	}
	_, err = tx.Exec(ctx, `
INSERT INTO master_work_mode_intervals(
  id, master_user_id, mode, starts_at, ends_at, timezone, organization_id, branch_id, chair_id,
  percentage_rate, city_id, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		in.ID, in.MasterUserID, in.Mode, in.StartsAt, in.EndsAt, in.Timezone, in.OrganizationID, in.BranchID, in.ChairID,
		in.PercentageRate, in.CityID, in.CreatedAt, in.UpdatedAt)
	if err != nil {
		if mapped := mapExclusion(err, "master_work_mode_intervals_no_overlap", intervalOverlapMsg); mapped != err {
			return mapped
		}
		return mapExclusion(err, "salon_chairs_interval_no_overlap", chairBusyMsg)
	}
	for _, d := range districtIDs {
		if _, err := tx.Exec(ctx, `
INSERT INTO master_work_mode_interval_districts(interval_id, district_id) VALUES ($1,$2)`, in.ID, d); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) DeleteWorkModeInterval(ctx context.Context, id, masterUserID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM master_work_mode_intervals WHERE id=$1 AND master_user_id=$2`, id, masterUserID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("work mode interval not found")
	}
	return nil
}

func (s *Store) GetWorkModeInterval(ctx context.Context, id uuid.UUID) (*domain.WorkModeInterval, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+intervalCols+` FROM master_work_mode_intervals WHERE id=$1`, id)
	in, err := scanInterval(row)
	if err != nil {
		return nil, err
	}
	if in == nil {
		return nil, nil
	}
	if err := s.attachIntervalExtras(ctx, []*domain.WorkModeInterval{in}); err != nil {
		return nil, err
	}
	return in, nil
}

func (s *Store) ListWorkModeIntervals(ctx context.Context, masterUserID uuid.UUID, from, to time.Time) ([]domain.WorkModeInterval, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+intervalCols+`
FROM master_work_mode_intervals
WHERE master_user_id=$1 AND starts_at < $3 AND ends_at > $2
ORDER BY starts_at`, masterUserID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return s.scanIntervalsWithExtras(ctx, rows)
}

func (s *Store) ListWorkModeIntervalsForMasters(ctx context.Context, masterIDs []uuid.UUID, from, to time.Time) ([]domain.WorkModeInterval, error) {
	if len(masterIDs) == 0 {
		return []domain.WorkModeInterval{}, nil
	}
	rows, err := s.pool.Query(ctx, `
SELECT `+intervalCols+`
FROM master_work_mode_intervals
WHERE master_user_id = ANY($1) AND starts_at < $3 AND ends_at > $2
ORDER BY starts_at`, masterIDs, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return s.scanIntervalsWithExtras(ctx, rows)
}

func (s *Store) ListOnsiteMatches(ctx context.Context, cityName string, districtID uuid.UUID, from, to time.Time) ([]domain.WorkModeInterval, error) {
	rows, err := s.pool.Query(ctx, `
SELECT i.id, i.master_user_id, i.mode, i.starts_at, i.ends_at, i.timezone, i.organization_id, i.branch_id, i.chair_id,
       i.percentage_rate, i.city_id, i.created_at, i.updated_at
FROM master_work_mode_intervals i
JOIN geo_cities c ON c.id = i.city_id
JOIN master_work_mode_interval_districts d ON d.interval_id = i.id
WHERE i.mode='onsite'
  AND lower(c.name) = lower($1)
  AND d.district_id = $2
  AND i.starts_at < $4 AND i.ends_at > $3
ORDER BY i.starts_at`, cityName, districtID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return s.scanIntervalsWithExtras(ctx, rows)
}

func (s *Store) ChairIntervalOverlap(ctx context.Context, chairID uuid.UUID, start, end time.Time, exclude uuid.UUID) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1 FROM master_work_mode_intervals
  WHERE mode='chair' AND chair_id=$1 AND id <> $4
    AND starts_at < $3 AND ends_at > $2
)`, chairID, start, end, exclude).Scan(&exists)
	return exists, err
}

func scanInterval(row pgx.Row) (*domain.WorkModeInterval, error) {
	var in domain.WorkModeInterval
	err := row.Scan(
		&in.ID, &in.MasterUserID, &in.Mode, &in.StartsAt, &in.EndsAt, &in.Timezone,
		&in.OrganizationID, &in.BranchID, &in.ChairID, &in.PercentageRate, &in.CityID,
		&in.CreatedAt, &in.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &in, nil
}

func (s *Store) scanIntervalsWithExtras(ctx context.Context, rows pgx.Rows) ([]domain.WorkModeInterval, error) {
	var items []domain.WorkModeInterval
	var ptrs []*domain.WorkModeInterval
	for rows.Next() {
		in, err := scanInterval(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, *in)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range items {
		ptrs = append(ptrs, &items[i])
	}
	if err := s.attachIntervalExtras(ctx, ptrs); err != nil {
		return nil, err
	}
	if items == nil {
		items = []domain.WorkModeInterval{}
	}
	return items, nil
}

func (s *Store) attachIntervalExtras(ctx context.Context, items []*domain.WorkModeInterval) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, 0, len(items))
	chairIDs := make([]uuid.UUID, 0)
	cityIDs := make([]uuid.UUID, 0)
	for _, in := range items {
		ids = append(ids, in.ID)
		if in.ChairID != nil {
			chairIDs = append(chairIDs, *in.ChairID)
		}
		if in.CityID != nil {
			cityIDs = append(cityIDs, *in.CityID)
		}
	}
	distRows, err := s.pool.Query(ctx, `
SELECT d.interval_id, g.id, g.city_id, g.name
FROM master_work_mode_interval_districts d
JOIN geo_districts g ON g.id = d.district_id
WHERE d.interval_id = ANY($1)
ORDER BY g.name`, ids)
	if err != nil {
		return err
	}
	defer distRows.Close()
	byInterval := map[uuid.UUID][]domain.GeoDistrict{}
	for distRows.Next() {
		var intervalID uuid.UUID
		var d domain.GeoDistrict
		if err := distRows.Scan(&intervalID, &d.ID, &d.CityID, &d.Name); err != nil {
			return err
		}
		byInterval[intervalID] = append(byInterval[intervalID], d)
	}
	if err := distRows.Err(); err != nil {
		return err
	}
	chairs := map[uuid.UUID]domain.SalonChair{}
	if len(chairIDs) > 0 {
		list, err := s.ListChairsByIDs(ctx, chairIDs)
		if err != nil {
			return err
		}
		for _, c := range list {
			chairs[c.ID] = c
		}
	}
	cities := map[uuid.UUID]domain.GeoCity{}
	if len(cityIDs) > 0 {
		cityRows, err := s.pool.Query(ctx, `SELECT id, name, timezone FROM geo_cities WHERE id = ANY($1)`, cityIDs)
		if err != nil {
			return err
		}
		defer cityRows.Close()
		for cityRows.Next() {
			var c domain.GeoCity
			if err := cityRows.Scan(&c.ID, &c.Name, &c.Timezone); err != nil {
				return err
			}
			cities[c.ID] = c
		}
		if err := cityRows.Err(); err != nil {
			return err
		}
	}
	for _, in := range items {
		in.Districts = byInterval[in.ID]
		if in.Districts == nil {
			in.Districts = []domain.GeoDistrict{}
		}
		if in.ChairID != nil {
			if c, ok := chairs[*in.ChairID]; ok {
				cp := c
				in.Chair = &cp
			}
		}
		if in.CityID != nil {
			if c, ok := cities[*in.CityID]; ok {
				cp := c
				in.City = &cp
			}
		}
	}
	return nil
}
