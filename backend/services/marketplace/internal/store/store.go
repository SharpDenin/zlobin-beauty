package store

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

type Store struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

const masterCols = `id, user_id, organization_id, branch_id, display_name, bio, specializations, city,
    experience_years, education, photo_media_id, rating_avg, rating_count, published, created_at, updated_at`

func (s *Store) UpsertMaster(ctx context.Context, m domain.MasterProfile) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO master_profiles(id, user_id, organization_id, branch_id, display_name, bio, specializations, city,
  experience_years, education, photo_media_id, rating_avg, rating_count, published, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
ON CONFLICT (user_id) DO UPDATE SET
  organization_id=EXCLUDED.organization_id,
  branch_id=EXCLUDED.branch_id,
  display_name=EXCLUDED.display_name,
  bio=EXCLUDED.bio,
  specializations=EXCLUDED.specializations,
  city=EXCLUDED.city,
  experience_years=EXCLUDED.experience_years,
  education=EXCLUDED.education,
  photo_media_id=EXCLUDED.photo_media_id,
  published=EXCLUDED.published,
  updated_at=EXCLUDED.updated_at`,
		m.ID, m.UserID, m.OrganizationID, m.BranchID, m.DisplayName, m.Bio, m.Specializations, m.City,
		m.ExperienceYears, m.Education, m.PhotoMediaID, m.RatingAvg, m.RatingCount, m.Published, m.CreatedAt, m.UpdatedAt)
	return err
}

func (s *Store) GetMasterByUser(ctx context.Context, userID uuid.UUID) (*domain.MasterProfile, error) {
	return s.scanMaster(s.pool.QueryRow(ctx, `SELECT `+masterCols+` FROM master_profiles WHERE user_id=$1`, userID))
}

func (s *Store) GetMaster(ctx context.Context, id uuid.UUID) (*domain.MasterProfile, error) {
	return s.scanMaster(s.pool.QueryRow(ctx, `SELECT `+masterCols+` FROM master_profiles WHERE id=$1`, id))
}

func (s *Store) scanMaster(row pgx.Row) (*domain.MasterProfile, error) {
	var m domain.MasterProfile
	if err := row.Scan(&m.ID, &m.UserID, &m.OrganizationID, &m.BranchID, &m.DisplayName, &m.Bio, &m.Specializations, &m.City,
		&m.ExperienceYears, &m.Education, &m.PhotoMediaID, &m.RatingAvg, &m.RatingCount, &m.Published, &m.CreatedAt, &m.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}

func (s *Store) SearchMasters(ctx context.Context, city, q, service string, priceMin, priceMax *int64, limit int) ([]domain.MasterProfile, error) {
	// Branch publication is enforced in service.Search via organizations internal API.
	rows, err := s.pool.Query(ctx, `
SELECT DISTINCT
  mp.id, mp.user_id, mp.organization_id, mp.branch_id, mp.display_name, mp.bio, mp.specializations, mp.city,
  mp.experience_years, mp.education, mp.photo_media_id, mp.rating_avg, mp.rating_count, mp.published, mp.created_at, mp.updated_at
FROM master_profiles mp
WHERE mp.published = TRUE
  AND ($1 = '' OR mp.city ILIKE $1)
  AND ($2 = '' OR mp.display_name ILIKE '%' || $2 || '%' OR EXISTS (SELECT 1 FROM unnest(mp.specializations) s WHERE s ILIKE '%' || $2 || '%'))
  AND (
    $3 = '' OR EXISTS (
      SELECT 1 FROM master_services ms
      JOIN services svc ON svc.id = ms.service_id AND svc.published = TRUE
      WHERE ms.master_id = mp.id
        AND (svc.name ILIKE '%' || $3 || '%' OR svc.category ILIKE '%' || $3 || '%')
    )
  )
  AND (
    $4::bigint IS NULL OR EXISTS (
      SELECT 1 FROM master_services ms
      JOIN services svc ON svc.id = ms.service_id AND svc.published = TRUE
      WHERE ms.master_id = mp.id
        AND COALESCE(ms.price_minor_override, svc.price_minor) >= $4
    )
  )
  AND (
    $5::bigint IS NULL OR EXISTS (
      SELECT 1 FROM master_services ms
      JOIN services svc ON svc.id = ms.service_id AND svc.published = TRUE
      WHERE ms.master_id = mp.id
        AND COALESCE(ms.price_minor_override, svc.price_minor) <= $5
    )
  )
ORDER BY mp.rating_avg DESC, mp.rating_count DESC, mp.id
LIMIT $6`, city, q, service, priceMin, priceMax, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.MasterProfile
	for rows.Next() {
		var m domain.MasterProfile
		if err := rows.Scan(&m.ID, &m.UserID, &m.OrganizationID, &m.BranchID, &m.DisplayName, &m.Bio, &m.Specializations, &m.City,
			&m.ExperienceYears, &m.Education, &m.PhotoMediaID, &m.RatingAvg, &m.RatingCount, &m.Published, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) CreateService(ctx context.Context, item domain.ServiceItem) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO services(id, organization_id, name, category, duration_minutes, price_minor, currency, published, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		item.ID, item.OrganizationID, item.Name, item.Category, item.DurationMinutes, item.PriceMinor, item.Currency, item.Published, item.CreatedAt, item.UpdatedAt)
	return err
}

func (s *Store) AttachService(ctx context.Context, masterID, serviceID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO master_services(master_id, service_id) VALUES ($1,$2)
ON CONFLICT DO NOTHING`, masterID, serviceID)
	return err
}

func (s *Store) ListMasterServices(ctx context.Context, masterID uuid.UUID) ([]domain.ServiceItem, error) {
	return s.listMasterServices(ctx, masterID, true)
}

func (s *Store) ListMasterServicesAll(ctx context.Context, masterID uuid.UUID) ([]domain.ServiceItem, error) {
	return s.listMasterServices(ctx, masterID, false)
}

func (s *Store) listMasterServices(ctx context.Context, masterID uuid.UUID, publishedOnly bool) ([]domain.ServiceItem, error) {
	query := `
SELECT s.id, s.organization_id, s.name, s.category, s.duration_minutes,
       COALESCE(ms.price_minor_override, s.price_minor), s.currency, s.published, s.created_at, s.updated_at
FROM master_services ms
JOIN services s ON s.id = ms.service_id
WHERE ms.master_id=$1`
	if publishedOnly {
		query += ` AND s.published=TRUE`
	}
	query += ` ORDER BY s.name`
	rows, err := s.pool.Query(ctx, query, masterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ServiceItem
	for rows.Next() {
		var item domain.ServiceItem
		if err := rows.Scan(&item.ID, &item.OrganizationID, &item.Name, &item.Category, &item.DurationMinutes, &item.PriceMinor, &item.Currency, &item.Published, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) UpdateService(ctx context.Context, item domain.ServiceItem) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE services
SET name=$2, category=$3, duration_minutes=$4, price_minor=$5, published=$6, updated_at=$7
WHERE id=$1`, item.ID, item.Name, item.Category, item.DurationMinutes, item.PriceMinor, item.Published, item.UpdatedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("service not found")
	}
	return nil
}

func (s *Store) CountPopularServices(ctx context.Context, limit int) ([]domain.ServiceItem, error) {
	rows, err := s.pool.Query(ctx, `
SELECT s.id, s.organization_id, s.name, s.category, s.duration_minutes, s.price_minor, s.currency, s.published, s.created_at, s.updated_at,
       mp.branch_id
FROM services s
JOIN master_services ms ON ms.service_id = s.id
JOIN master_profiles mp ON mp.id = ms.master_id AND mp.published = TRUE
WHERE s.published = TRUE
ORDER BY s.created_at DESC
LIMIT $1`, limit*3)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	seen := map[uuid.UUID]struct{}{}
	var out []domain.ServiceItem
	for rows.Next() {
		var item domain.ServiceItem
		var branchID *uuid.UUID
		if err := rows.Scan(&item.ID, &item.OrganizationID, &item.Name, &item.Category, &item.DurationMinutes, &item.PriceMinor, &item.Currency, &item.Published, &item.CreatedAt, &item.UpdatedAt, &branchID); err != nil {
			return nil, err
		}
		if _, ok := seen[item.ID]; ok {
			continue
		}
		seen[item.ID] = struct{}{}
		item.BranchID = branchID
		out = append(out, item)
		if len(out) >= limit {
			break
		}
	}
	return out, rows.Err()
}

func (s *Store) GetService(ctx context.Context, id uuid.UUID) (*domain.ServiceItem, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, organization_id, name, category, duration_minutes, price_minor, currency, published, created_at, updated_at
FROM services WHERE id=$1`, id)
	var item domain.ServiceItem
	if err := row.Scan(&item.ID, &item.OrganizationID, &item.Name, &item.Category, &item.DurationMinutes, &item.PriceMinor, &item.Currency, &item.Published, &item.CreatedAt, &item.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &item, nil
}

// --- service categories ---

const serviceCategoryCols = `id, name, slug, sort_order, created_at`

func (s *Store) ListServiceCategories(ctx context.Context) ([]domain.ServiceCategory, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+serviceCategoryCols+` FROM service_categories ORDER BY sort_order, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ServiceCategory
	for rows.Next() {
		var c domain.ServiceCategory
		if err := rows.Scan(&c.ID, &c.Name, &c.Slug, &c.SortOrder, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) CreateServiceCategory(ctx context.Context, c domain.ServiceCategory) (*domain.ServiceCategory, error) {
	var out domain.ServiceCategory
	err := s.pool.QueryRow(ctx, `
INSERT INTO service_categories(id, name, slug, sort_order, created_at)
VALUES ($1,$2,$3,$4,$5)
RETURNING `+serviceCategoryCols,
		c.ID, c.Name, c.Slug, c.SortOrder, c.CreatedAt,
	).Scan(&out.ID, &out.Name, &out.Slug, &out.SortOrder, &out.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *Store) UpdateServiceCategory(ctx context.Context, c domain.ServiceCategory) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE service_categories SET name=$2, slug=$3, sort_order=$4 WHERE id=$1`,
		c.ID, c.Name, c.Slug, c.SortOrder)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("service category not found")
	}
	return nil
}

func (s *Store) DeleteServiceCategory(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM service_categories WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("service category not found")
	}
	return nil
}

// --- knowledge base ---

const knowledgeCols = `id, title, category, content, author_user_id, author_org_id, author_name, published, created_at, updated_at`

func (s *Store) CreateKnowledgeArticle(ctx context.Context, a domain.KnowledgeArticle) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO knowledge_articles(`+knowledgeCols+`)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		a.ID, a.Title, a.Category, a.Content, a.AuthorUserID, a.AuthorOrgID, a.AuthorName, a.Published, a.CreatedAt, a.UpdatedAt)
	return err
}

func (s *Store) UpdateKnowledgeArticle(ctx context.Context, a domain.KnowledgeArticle) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE knowledge_articles
SET title=$2, category=$3, content=$4, author_org_id=$5, author_name=$6, published=$7, updated_at=$8
WHERE id=$1`, a.ID, a.Title, a.Category, a.Content, a.AuthorOrgID, a.AuthorName, a.Published, a.UpdatedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("article not found")
	}
	return nil
}

func (s *Store) GetKnowledgeArticle(ctx context.Context, id uuid.UUID) (*domain.KnowledgeArticle, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+knowledgeCols+` FROM knowledge_articles WHERE id=$1`, id)
	return scanKnowledge(row)
}

func (s *Store) ListKnowledgeArticles(ctx context.Context, category string, publishedOnly bool, limit int) ([]domain.KnowledgeArticle, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
SELECT `+knowledgeCols+`
FROM knowledge_articles
WHERE ($1 = '' OR category ILIKE $1)
  AND ($2 = FALSE OR published = TRUE)
ORDER BY created_at DESC
LIMIT $3`, category, publishedOnly, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.KnowledgeArticle
	for rows.Next() {
		var a domain.KnowledgeArticle
		if err := rows.Scan(&a.ID, &a.Title, &a.Category, &a.Content, &a.AuthorUserID, &a.AuthorOrgID, &a.AuthorName, &a.Published, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func scanKnowledge(row pgx.Row) (*domain.KnowledgeArticle, error) {
	var a domain.KnowledgeArticle
	if err := row.Scan(&a.ID, &a.Title, &a.Category, &a.Content, &a.AuthorUserID, &a.AuthorOrgID, &a.AuthorName, &a.Published, &a.CreatedAt, &a.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &a, nil
}
