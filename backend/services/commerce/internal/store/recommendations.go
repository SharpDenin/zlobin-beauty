package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
)

const recoColumns = `r.id, r.master_user_id, r.product_id, r.client_user_id, r.comment, r.expires_at, r.created_at`

func (s *Store) InsertRecommendation(ctx context.Context, r domain.ProductRecommendation) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO product_recommendations(id, master_user_id, product_id, client_user_id, comment, expires_at, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		r.ID, r.MasterUserID, r.ProductID, r.ClientUserID, r.Comment, r.ExpiresAt, r.CreatedAt)
	return err
}

func (s *Store) GetRecommendation(ctx context.Context, id uuid.UUID) (*domain.ProductRecommendation, error) {
	row := s.pool.QueryRow(ctx, `
SELECT `+recoColumns+`
FROM product_recommendations r
WHERE r.id = $1`, id)
	return scanRecommendation(row)
}

func (s *Store) ListRecommendationsByMaster(ctx context.Context, masterUserID uuid.UUID) ([]domain.ProductRecommendation, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+recoColumns+`
FROM product_recommendations r
WHERE r.master_user_id = $1
ORDER BY r.created_at DESC`, masterUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRecommendations(rows)
}

func (s *Store) DeleteRecommendation(ctx context.Context, id uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM product_recommendations WHERE id = $1`, id)
	return err
}

func (s *Store) ListShopRecommendations(ctx context.Context, clientUserID uuid.UUID, now time.Time) ([]domain.ShopRecommendation, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+recoColumns+`, p.id, p.organization_id, p.parent_id, p.category_id, p.brand, p.name, p.sku, p.description, p.unit, p.volume_label,
       p.price_minor, p.currency, p.min_stock, p.published, p.created_at, p.updated_at, `+availableSubquery+` AS available
FROM product_recommendations r
JOIN products p ON p.id = r.product_id
WHERE p.published = true
  AND (r.client_user_id IS NULL OR r.client_user_id = $1)
  AND (r.expires_at IS NULL OR r.expires_at > $2)
ORDER BY r.created_at DESC`, clientUserID, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ShopRecommendation
	for rows.Next() {
		var sr domain.ShopRecommendation
		if err := rows.Scan(
			&sr.ID, &sr.MasterUserID, &sr.ProductID, &sr.ClientUserID, &sr.Comment, &sr.ExpiresAt, &sr.CreatedAt,
			&sr.Product.ID, &sr.Product.OrganizationID, &sr.Product.ParentID, &sr.Product.CategoryID, &sr.Product.Brand, &sr.Product.Name,
			&sr.Product.SKU, &sr.Product.Description, &sr.Product.Unit, &sr.Product.VolumeLabel,
			&sr.Product.PriceMinor, &sr.Product.Currency, &sr.Product.MinStock, &sr.Product.Published,
			&sr.Product.CreatedAt, &sr.Product.UpdatedAt, &sr.Product.Available,
		); err != nil {
			return nil, err
		}
		out = append(out, sr)
	}
	return out, rows.Err()
}

func scanRecommendation(row pgx.Row) (*domain.ProductRecommendation, error) {
	var r domain.ProductRecommendation
	if err := row.Scan(&r.ID, &r.MasterUserID, &r.ProductID, &r.ClientUserID, &r.Comment, &r.ExpiresAt, &r.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

func scanRecommendations(rows pgx.Rows) ([]domain.ProductRecommendation, error) {
	var out []domain.ProductRecommendation
	for rows.Next() {
		var r domain.ProductRecommendation
		if err := rows.Scan(&r.ID, &r.MasterUserID, &r.ProductID, &r.ClientUserID, &r.Comment, &r.ExpiresAt, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
