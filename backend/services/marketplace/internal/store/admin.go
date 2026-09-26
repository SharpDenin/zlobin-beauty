package store

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
)

type MasterListFilter struct {
	Query          string
	City           string
	OrganizationID *uuid.UUID
	UserID         *uuid.UUID
	Published      *bool
	Limit          int
	Offset         int
}

type ServiceListFilter struct {
	Query          string
	Category       string
	OrganizationID *uuid.UUID
	MasterID       *uuid.UUID
	MasterUserID   *uuid.UUID
	Published      *bool
	Limit          int
	Offset         int
}

type MarketplaceStats struct {
	MastersTotal     int
	MastersPublished int
	ServicesTotal    int
	ArticlesTotal    int
	ArticlesDraft    int
	ArticlesPublished int
}

func adminPage(limit, offset int) (int, int) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func (s *Store) ListMastersAdmin(ctx context.Context, f MasterListFilter) ([]domain.MasterProfile, error) {
	limit, offset := adminPage(f.Limit, f.Offset)
	q := strings.TrimSpace(f.Query)
	like := "%" + q + "%"
	city := strings.TrimSpace(f.City)
	cityLike := "%" + city + "%"
	rows, err := s.pool.Query(ctx, `
SELECT `+masterCols+`
FROM master_profiles
WHERE ($1 = '' OR display_name ILIKE $2 OR city ILIKE $2)
  AND ($3 = '' OR city ILIKE $4)
  AND ($5::uuid IS NULL OR organization_id = $5)
  AND ($6::uuid IS NULL OR user_id = $6)
  AND ($7::bool IS NULL OR published = $7)
ORDER BY display_name
LIMIT $8 OFFSET $9`, q, like, city, cityLike, f.OrganizationID, f.UserID, f.Published, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.MasterProfile
	for rows.Next() {
		m, err := scanMasterRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	if out == nil {
		out = []domain.MasterProfile{}
	}
	return out, rows.Err()
}

func (s *Store) CountMastersAdmin(ctx context.Context, f MasterListFilter) (int, error) {
	q := strings.TrimSpace(f.Query)
	like := "%" + q + "%"
	city := strings.TrimSpace(f.City)
	cityLike := "%" + city + "%"
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM master_profiles
WHERE ($1 = '' OR display_name ILIKE $2 OR city ILIKE $2)
  AND ($3 = '' OR city ILIKE $4)
  AND ($5::uuid IS NULL OR organization_id = $5)
  AND ($6::uuid IS NULL OR user_id = $6)
  AND ($7::bool IS NULL OR published = $7)`, q, like, city, cityLike, f.OrganizationID, f.UserID, f.Published).Scan(&n)
	return n, err
}

func scanMasterRow(rows interface{ Scan(dest ...any) error }) (*domain.MasterProfile, error) {
	var m domain.MasterProfile
	if err := rows.Scan(&m.ID, &m.UserID, &m.OrganizationID, &m.BranchID, &m.DisplayName, &m.Bio, &m.Specializations, &m.City,
		&m.ExperienceYears, &m.Education, &m.PhotoMediaID, &m.WorkType, &m.RatingAvg, &m.RatingCount, &m.Published, &m.CreatedAt, &m.UpdatedAt); err != nil {
		return nil, err
	}
	return &m, nil
}

func (s *Store) SetMasterPublished(ctx context.Context, id uuid.UUID, published bool, at time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE master_profiles SET published=$2, updated_at=$3 WHERE id=$1`, id, published, at)
	return err
}

func (s *Store) ListServicesAdmin(ctx context.Context, f ServiceListFilter) ([]domain.ServiceItem, error) {
	limit, offset := adminPage(f.Limit, f.Offset)
	q := strings.TrimSpace(f.Query)
	like := "%" + q + "%"
	cat := strings.TrimSpace(f.Category)
	rows, err := s.pool.Query(ctx, `
SELECT DISTINCT s.id, s.organization_id, s.name, s.category, s.description, s.notes, s.duration_minutes,
       s.price_minor, s.currency, s.photo_media_id, s.booking_mode, s.published, s.archived_at, s.created_at, s.updated_at
FROM services s
LEFT JOIN master_services ms ON ms.service_id = s.id
LEFT JOIN master_profiles mp ON mp.id = ms.master_id
WHERE ($1 = '' OR s.name ILIKE $2 OR s.category ILIKE $2)
  AND ($3 = '' OR s.category ILIKE $3)
  AND ($4::uuid IS NULL OR s.organization_id = $4)
  AND ($5::uuid IS NULL OR ms.master_id = $5)
  AND ($6::uuid IS NULL OR mp.user_id = $6)
  AND ($7::bool IS NULL OR s.published = $7)
ORDER BY s.name
LIMIT $8 OFFSET $9`, q, like, cat, f.OrganizationID, f.MasterID, f.MasterUserID, f.Published, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ServiceItem
	for rows.Next() {
		var item domain.ServiceItem
		if err := rows.Scan(&item.ID, &item.OrganizationID, &item.Name, &item.Category, &item.Description, &item.Notes,
			&item.DurationMinutes, &item.PriceMinor, &item.Currency, &item.PhotoMediaID, &item.BookingMode, &item.Published, &item.ArchivedAt, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		if item.BookingMode == "" {
			item.BookingMode = "flexible"
		}
		out = append(out, item)
	}
	if out == nil {
		out = []domain.ServiceItem{}
	}
	return out, rows.Err()
}

func (s *Store) CountServicesAdmin(ctx context.Context, f ServiceListFilter) (int, error) {
	q := strings.TrimSpace(f.Query)
	like := "%" + q + "%"
	cat := strings.TrimSpace(f.Category)
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM (
SELECT DISTINCT s.id
FROM services s
LEFT JOIN master_services ms ON ms.service_id = s.id
LEFT JOIN master_profiles mp ON mp.id = ms.master_id
WHERE ($1 = '' OR s.name ILIKE $2 OR s.category ILIKE $2)
  AND ($3 = '' OR s.category ILIKE $3)
  AND ($4::uuid IS NULL OR s.organization_id = $4)
  AND ($5::uuid IS NULL OR ms.master_id = $5)
  AND ($6::uuid IS NULL OR mp.user_id = $6)
  AND ($7::bool IS NULL OR s.published = $7)
) t`, q, like, cat, f.OrganizationID, f.MasterID, f.MasterUserID, f.Published).Scan(&n)
	return n, err
}

func (s *Store) SetServicePublished(ctx context.Context, id uuid.UUID, published bool, at time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE services SET published=$2, updated_at=$3 WHERE id=$1`, id, published, at)
	return err
}

func (s *Store) MarketplaceStats(ctx context.Context) (MarketplaceStats, error) {
	var st MarketplaceStats
	err := s.pool.QueryRow(ctx, `
SELECT
  (SELECT COUNT(*)::int FROM master_profiles),
  (SELECT COUNT(*)::int FROM master_profiles WHERE published = TRUE),
  (SELECT COUNT(*)::int FROM services),
  (SELECT COUNT(*)::int FROM knowledge_articles),
  (SELECT COUNT(*)::int FROM knowledge_articles WHERE status = 'draft'),
  (SELECT COUNT(*)::int FROM knowledge_articles WHERE status = 'published')`).
		Scan(&st.MastersTotal, &st.MastersPublished, &st.ServicesTotal, &st.ArticlesTotal, &st.ArticlesDraft, &st.ArticlesPublished)
	return st, err
}
