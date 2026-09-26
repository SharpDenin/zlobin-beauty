package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
)

type ProductListFilter struct {
	Query          string
	OrganizationID *uuid.UUID
	CategoryID     *uuid.UUID
	Audience       string
	Published      *bool
	Limit          int
	Offset         int
}

type OrderListFilter struct {
	Query         string
	Status        string
	UserID        *uuid.UUID
	SupplierOrgID *uuid.UUID
	Limit         int
	Offset        int
}

type CommerceStats struct {
	ProductsTotal     int
	ProductsPublished int
	OrdersTotal       int
}

type AdminProduct struct {
	domain.Product
	Available float64
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

func scanAdminProduct(row interface{ Scan(dest ...any) error }) (*AdminProduct, error) {
	var p domain.Product
	var avail float64
	if err := row.Scan(&p.ID, &p.OrganizationID, &p.ParentID, &p.CategoryID, &p.Brand, &p.Name, &p.SKU, &p.Description, &p.Unit, &p.VolumeLabel,
		&p.PriceMinor, &p.Currency, &p.MinStock, &p.Published, &p.ForSale, &p.DeliveryDays, &p.PhotoMediaID, &p.Audience, &p.ArchivedAt, &p.CreatedAt, &p.UpdatedAt, &avail); err != nil {
		return nil, err
	}
	return &AdminProduct{Product: p, Available: avail}, nil
}

func (s *Store) ListProductsAdmin(ctx context.Context, f ProductListFilter) ([]AdminProduct, error) {
	limit, offset := adminPage(f.Limit, f.Offset)
	q := strings.TrimSpace(f.Query)
	like := "%" + q + "%"
	rows, err := s.pool.Query(ctx, `
SELECT `+productColumns+`, `+availableSubquery+` AS available
FROM products p
WHERE p.parent_id IS NULL
  AND p.archived_at IS NULL
  AND ($1 = '' OR p.name ILIKE $2 OR p.brand ILIKE $2 OR p.sku ILIKE $2)
  AND ($3::uuid IS NULL OR p.organization_id = $3)
  AND ($4::uuid IS NULL OR p.category_id = $4)
  AND ($5 = '' OR p.audience = $5)
  AND ($6::bool IS NULL OR p.published = $6)
ORDER BY p.name
LIMIT $7 OFFSET $8`, q, like, f.OrganizationID, f.CategoryID, strings.TrimSpace(f.Audience), f.Published, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AdminProduct
	for rows.Next() {
		item, err := scanAdminProduct(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *item)
	}
	if out == nil {
		out = []AdminProduct{}
	}
	return out, rows.Err()
}

func (s *Store) CountProductsAdmin(ctx context.Context, f ProductListFilter) (int, error) {
	q := strings.TrimSpace(f.Query)
	like := "%" + q + "%"
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM products p
WHERE p.parent_id IS NULL
  AND p.archived_at IS NULL
  AND ($1 = '' OR p.name ILIKE $2 OR p.brand ILIKE $2 OR p.sku ILIKE $2)
  AND ($3::uuid IS NULL OR p.organization_id = $3)
  AND ($4::uuid IS NULL OR p.category_id = $4)
  AND ($5 = '' OR p.audience = $5)
  AND ($6::bool IS NULL OR p.published = $6)`, q, like, f.OrganizationID, f.CategoryID, strings.TrimSpace(f.Audience), f.Published).Scan(&n)
	return n, err
}

func (s *Store) GetProductAdmin(ctx context.Context, id uuid.UUID) (*AdminProduct, error) {
	row := s.pool.QueryRow(ctx, `
SELECT `+productColumns+`, `+availableSubquery+` AS available
FROM products p WHERE p.id = $1`, id)
	item, err := scanAdminProduct(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return item, nil
}

func (s *Store) SetProductPublished(ctx context.Context, id uuid.UUID, published bool, at time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE products SET published=$2, updated_at=$3 WHERE id=$1`, id, published, at)
	return err
}

func (s *Store) ListOrdersAdmin(ctx context.Context, f OrderListFilter) ([]domain.ClientOrder, error) {
	limit, offset := adminPage(f.Limit, f.Offset)
	q := strings.TrimSpace(f.Query)
	like := "%" + q + "%"
	rows, err := s.pool.Query(ctx, `
SELECT `+clientOrderColumns+`
FROM client_orders
WHERE ($1 = '' OR id::text ILIKE $2 OR delivery_address ILIKE $2)
  AND ($3 = '' OR status = $3)
  AND ($4::uuid IS NULL OR user_id = $4)
  AND ($5::uuid IS NULL OR supplier_org_id = $5)
ORDER BY created_at DESC
LIMIT $6 OFFSET $7`, q, like, strings.TrimSpace(f.Status), f.UserID, f.SupplierOrgID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ClientOrder
	for rows.Next() {
		o, err := scanClientOrderRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *o)
	}
	if out == nil {
		out = []domain.ClientOrder{}
	}
	return out, rows.Err()
}

func (s *Store) CountOrdersAdmin(ctx context.Context, f OrderListFilter) (int, error) {
	q := strings.TrimSpace(f.Query)
	like := "%" + q + "%"
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM client_orders
WHERE ($1 = '' OR id::text ILIKE $2 OR delivery_address ILIKE $2)
  AND ($3 = '' OR status = $3)
  AND ($4::uuid IS NULL OR user_id = $4)
  AND ($5::uuid IS NULL OR supplier_org_id = $5)`, q, like, strings.TrimSpace(f.Status), f.UserID, f.SupplierOrgID).Scan(&n)
	return n, err
}

func (s *Store) CommerceStats(ctx context.Context) (CommerceStats, error) {
	var st CommerceStats
	err := s.pool.QueryRow(ctx, `
SELECT
  (SELECT COUNT(*)::int FROM products WHERE parent_id IS NULL AND archived_at IS NULL),
  (SELECT COUNT(*)::int FROM products WHERE parent_id IS NULL AND archived_at IS NULL AND published = TRUE),
  (SELECT COUNT(*)::int FROM client_orders)`).Scan(&st.ProductsTotal, &st.ProductsPublished, &st.OrdersTotal)
	return st, err
}
