package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
)

func (s *Store) GetMasterLocation(ctx context.Context, orgID, ownerUserID uuid.UUID) (*domain.StockLocation, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, organization_id, name, kind, owner_user_id, created_at
FROM stock_locations
WHERE organization_id=$1 AND kind=$2 AND owner_user_id=$3
ORDER BY created_at
LIMIT 1`, orgID, domain.LocationMaster, ownerUserID)
	return scanLocation(row)
}

func (s *Store) GetOrCreateMasterLocation(ctx context.Context, orgID, ownerUserID uuid.UUID, name string) (*domain.StockLocation, error) {
	existing, err := s.GetMasterLocation(ctx, orgID, ownerUserID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}
	now := time.Now().UTC()
	owner := ownerUserID
	l := domain.StockLocation{
		ID: uuid.Must(uuid.NewV7()), OrganizationID: orgID, Name: name,
		Kind: domain.LocationMaster, OwnerUserID: &owner, CreatedAt: now,
	}
	if err := s.CreateLocation(ctx, l); err != nil {
		if isUniqueViolation(err) {
			return s.GetMasterLocation(ctx, orgID, ownerUserID)
		}
		return nil, err
	}
	return &l, nil
}

func (s *Store) GetMovementByIdempotencyKey(ctx context.Context, key string) (*domain.StockMovement, error) {
	if key == "" {
		return nil, nil
	}
	row := s.pool.QueryRow(ctx, `
SELECT id, location_id, product_id, kind, qty, qty_before, qty_after, reason, actor_user_id, ref_type, ref_id, created_at, COALESCE(idempotency_key, '')
FROM stock_movements WHERE idempotency_key=$1`, key)
	var m domain.StockMovement
	if err := row.Scan(&m.ID, &m.LocationID, &m.ProductID, &m.Kind, &m.Qty, &m.QtyBefore, &m.QtyAfter, &m.Reason, &m.ActorUserID, &m.RefType, &m.RefID, &m.CreatedAt, &m.IdempotencyKey); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}

func (s *Store) GetBalanceView(ctx context.Context, locationID, productID uuid.UUID) (*domain.StockBalanceView, error) {
	row := s.pool.QueryRow(ctx, `
SELECT sb.location_id, sb.product_id, sb.qty_on_hand, sb.qty_reserved, sb.updated_at,
       p.name, p.brand, p.sku, p.min_stock, p.price_minor, p.currency, p.photo_media_id, p.unit, p.volume_label
FROM stock_balances sb
JOIN products p ON p.id = sb.product_id
WHERE sb.location_id=$1 AND sb.product_id=$2`, locationID, productID)
	var v domain.StockBalanceView
	if err := row.Scan(&v.LocationID, &v.ProductID, &v.QtyOnHand, &v.QtyReserved, &v.UpdatedAt,
		&v.ProductName, &v.ProductBrand, &v.ProductSKU, &v.MinStock, &v.PriceMinor, &v.Currency, &v.PhotoMediaID,
		&v.Unit, &v.VolumeLabel); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	v.Status = domain.StockStatus(v.QtyOnHand, v.QtyReserved, v.MinStock)
	return &v, nil
}

func (s *Store) ListMovementsByProduct(ctx context.Context, locationID, productID uuid.UUID, limit int) ([]domain.StockMovement, error) {
	if limit <= 0 || limit > 200 {
		limit = 80
	}
	rows, err := s.pool.Query(ctx, `
SELECT id, location_id, product_id, kind, qty, qty_before, qty_after, reason, actor_user_id, ref_type, ref_id, created_at, COALESCE(idempotency_key, '')
FROM stock_movements
WHERE location_id=$1 AND product_id=$2
ORDER BY created_at DESC
LIMIT $3`, locationID, productID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.StockMovement
	for rows.Next() {
		var m domain.StockMovement
		if err := rows.Scan(&m.ID, &m.LocationID, &m.ProductID, &m.Kind, &m.Qty, &m.QtyBefore, &m.QtyAfter, &m.Reason, &m.ActorUserID, &m.RefType, &m.RefID, &m.CreatedAt, &m.IdempotencyKey); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	if out == nil {
		out = []domain.StockMovement{}
	}
	return out, rows.Err()
}

func (s *Store) ListPendingBuyerOrders(ctx context.Context, buyerOrgID, locationID uuid.UUID) ([]domain.SupplierOrder, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+orderColumns+`
FROM supplier_orders
WHERE buyer_org_id=$1
  AND location_id=$2
  AND status IN ('delivered', 'completed', 'accepted_partial')
  AND EXISTS (
    SELECT 1 FROM supplier_order_items i
    WHERE i.order_id = supplier_orders.id
      AND (i.qty_ordered - i.qty_accepted - i.qty_damaged - i.qty_rejected) > 0.0001
  )
ORDER BY created_at DESC`, buyerOrgID, locationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.SupplierOrder
	for rows.Next() {
		o, err := scanOrderRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *o)
	}
	if out == nil {
		out = []domain.SupplierOrder{}
	}
	return out, rows.Err()
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
