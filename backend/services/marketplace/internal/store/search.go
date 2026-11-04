package store

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
)

const searchServiceNamesLimit = 8

// SearchCursor is a keyset cursor matching ORDER BY city_rank, rating_avg DESC, rating_count DESC, id.
type SearchCursor struct {
	CityRank    int
	RatingAvg   float64
	RatingCount int
	ID          uuid.UUID
}

type SearchMastersParams struct {
	City               string
	Q                  string
	Service            string
	PriceMin           *int64
	PriceMax           *int64
	IncludeOtherCities bool
	Limit              int
	Cursor             *SearchCursor
}

// SearchMasterRow is one search hit with card enrichment from published services.
type SearchMasterRow struct {
	Master        domain.MasterProfile
	CityRank      int
	ServiceNames  []string
	PriceMinMinor *int64
	PriceMaxMinor *int64
}

func (s *Store) SearchMasters(ctx context.Context, p SearchMastersParams) ([]SearchMasterRow, error) {
	cityFilter := p.City
	if p.IncludeOtherCities {
		cityFilter = ""
	}
	limit := p.Limit
	if limit <= 0 {
		limit = 50
	}

	args := []any{cityFilter, p.Q, p.Service, p.PriceMin, p.PriceMax, limit, p.City}
	cursorSQL := ""
	if p.Cursor != nil {
		// $8 city_rank, $9 rating_avg, $10 rating_count, $11 id
		// ORDER BY city_rank ASC, rating_avg DESC, rating_count DESC, id ASC
		args = append(args, p.Cursor.CityRank, p.Cursor.RatingAvg, p.Cursor.RatingCount, p.Cursor.ID)
		cursorSQL = `
  AND (
    (CASE WHEN $7 <> '' AND mp.city ILIKE $7 THEN 0 ELSE 1 END) > $8
    OR (
      (CASE WHEN $7 <> '' AND mp.city ILIKE $7 THEN 0 ELSE 1 END) = $8
      AND mp.rating_avg < $9
    )
    OR (
      (CASE WHEN $7 <> '' AND mp.city ILIKE $7 THEN 0 ELSE 1 END) = $8
      AND mp.rating_avg = $9
      AND mp.rating_count < $10
    )
    OR (
      (CASE WHEN $7 <> '' AND mp.city ILIKE $7 THEN 0 ELSE 1 END) = $8
      AND mp.rating_avg = $9
      AND mp.rating_count = $10
      AND mp.id > $11
    )
  )`
	}

	query := `
SELECT
  mp.id, mp.user_id, mp.organization_id, mp.branch_id, mp.display_name, mp.bio, mp.specializations, mp.city,
  mp.experience_years, mp.education, mp.photo_media_id, mp.work_type, coalesce(mp.work_types, '{}'),
  mp.rating_avg, mp.rating_count, mp.published, mp.created_at, mp.updated_at,
  CASE WHEN $7 <> '' AND mp.city ILIKE $7 THEN 0 ELSE 1 END AS city_rank,
  COALESCE((
    SELECT array_agg(x.name ORDER BY x.name)
    FROM (
      SELECT svc.name
      FROM master_services ms
      JOIN services svc ON svc.id = ms.service_id AND svc.published = TRUE AND svc.archived_at IS NULL
      WHERE ms.master_id = mp.id
      ORDER BY svc.name
      LIMIT ` + fmt.Sprintf("%d", searchServiceNamesLimit) + `
    ) x
  ), '{}') AS service_names,
  (
    SELECT MIN(COALESCE(ms.price_minor_override, svc.price_minor))
    FROM master_services ms
    JOIN services svc ON svc.id = ms.service_id AND svc.published = TRUE AND svc.archived_at IS NULL
    WHERE ms.master_id = mp.id
  ) AS price_min_minor,
  (
    SELECT MAX(COALESCE(ms.price_minor_override, svc.price_minor))
    FROM master_services ms
    JOIN services svc ON svc.id = ms.service_id AND svc.published = TRUE AND svc.archived_at IS NULL
    WHERE ms.master_id = mp.id
  ) AS price_max_minor
FROM master_profiles mp
WHERE ($1 = '' OR mp.city ILIKE $1)
  AND (
    $2 = ''
    OR mp.display_name ILIKE '%' || $2 || '%'
    OR EXISTS (SELECT 1 FROM unnest(mp.specializations) s WHERE s ILIKE '%' || $2 || '%')
    OR EXISTS (
      SELECT 1
      FROM master_profile_types mpt
      JOIN master_types mt ON mt.id = mpt.profession_type_id AND mt.is_active = TRUE
      WHERE mpt.master_user_id = mp.user_id
        AND (mt.name ILIKE '%' || $2 || '%' OR mt.slug ILIKE '%' || $2 || '%')
    )
    OR EXISTS (
      SELECT 1 FROM portfolio_items pi
      WHERE pi.master_id = mp.id
        AND (
          pi.title ILIKE '%' || $2 || '%'
          OR pi.caption ILIKE '%' || $2 || '%'
          OR pi.description ILIKE '%' || $2 || '%'
          OR pi.category ILIKE '%' || $2 || '%'
        )
    )
  )
  AND (
    $3 = '' OR EXISTS (
      SELECT 1 FROM master_services ms
      JOIN services svc ON svc.id = ms.service_id AND svc.published = TRUE AND svc.archived_at IS NULL
      WHERE ms.master_id = mp.id
        AND (svc.name ILIKE '%' || $3 || '%' OR svc.category ILIKE '%' || $3 || '%')
    )
  )
  AND (
    $4::bigint IS NULL OR EXISTS (
      SELECT 1 FROM master_services ms
      JOIN services svc ON svc.id = ms.service_id AND svc.published = TRUE AND svc.archived_at IS NULL
      WHERE ms.master_id = mp.id
        AND COALESCE(ms.price_minor_override, svc.price_minor) >= $4
    )
  )
  AND (
    $5::bigint IS NULL OR EXISTS (
      SELECT 1 FROM master_services ms
      JOIN services svc ON svc.id = ms.service_id AND svc.published = TRUE AND svc.archived_at IS NULL
      WHERE ms.master_id = mp.id
        AND COALESCE(ms.price_minor_override, svc.price_minor) <= $5
    )
  )` + cursorSQL + `
ORDER BY city_rank ASC, mp.rating_avg DESC, mp.rating_count DESC, mp.id
LIMIT $6`

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []SearchMasterRow
	for rows.Next() {
		var m domain.MasterProfile
		var orgID *uuid.UUID
		var cityRank int
		var names []string
		var priceMin, priceMax *int64
		if err := rows.Scan(
			&m.ID, &m.UserID, &orgID, &m.BranchID, &m.DisplayName, &m.Bio, &m.Specializations, &m.City,
			&m.ExperienceYears, &m.Education, &m.PhotoMediaID, &m.WorkType, &m.WorkTypes,
			&m.RatingAvg, &m.RatingCount, &m.Published, &m.CreatedAt, &m.UpdatedAt,
			&cityRank, &names, &priceMin, &priceMax,
		); err != nil {
			return nil, err
		}
		if orgID != nil {
			m.OrganizationID = *orgID
		}
		if len(m.WorkTypes) == 0 && m.WorkType != "" {
			m.WorkTypes = []string{m.WorkType}
		}
		if names == nil {
			names = []string{}
		}
		out = append(out, SearchMasterRow{
			Master:        m,
			CityRank:      cityRank,
			ServiceNames:  names,
			PriceMinMinor: priceMin,
			PriceMaxMinor: priceMax,
		})
	}
	return out, rows.Err()
}
