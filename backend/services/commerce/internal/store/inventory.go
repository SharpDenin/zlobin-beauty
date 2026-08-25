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

func (s *Store) ListBuyerOrdersForLocation(ctx context.Context, buyerOrgID, locationID uuid.UUID, pendingOnly bool) ([]domain.SupplierOrder, error) {
	q := `
SELECT ` + orderColumns + `
FROM supplier_orders
WHERE buyer_org_id=$1
  AND location_id=$2
  AND status IN ('delivered', 'completed', 'accepted_partial', 'accepted_full')`
	if pendingOnly {
		q += `
  AND EXISTS (
    SELECT 1 FROM supplier_order_items i
    WHERE i.order_id = supplier_orders.id
      AND (i.qty_ordered - i.qty_accepted - i.qty_damaged - i.qty_rejected) > 0.0001
  )`
	}
	q += `
ORDER BY created_at DESC`
	rows, err := s.pool.Query(ctx, q, buyerOrgID, locationID)
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

func (s *Store) ListPendingBuyerOrders(ctx context.Context, buyerOrgID, locationID uuid.UUID) ([]domain.SupplierOrder, error) {
	return s.ListBuyerOrdersForLocation(ctx, buyerOrgID, locationID, true)
}

type IncomingLine struct {
	ProductID  uuid.UUID
	Qty        float64
	ExpectedAt *time.Time
}

func (s *Store) IncomingRemainingByLocation(ctx context.Context, buyerOrgID, locationID uuid.UUID) ([]IncomingLine, error) {
	rows, err := s.pool.Query(ctx, `
SELECT i.product_id,
       COALESCE(SUM(GREATEST(i.qty_ordered - i.qty_accepted - i.qty_damaged - i.qty_rejected, 0)), 0)::float8,
       MIN(COALESCE(o.estimated_delivery_at, o.updated_at))
FROM supplier_order_items i
JOIN supplier_orders o ON o.id = i.order_id
WHERE o.buyer_org_id=$1
  AND o.location_id=$2
  AND o.status IN ('confirmed','processing','picking','ready_for_dispatch','in_transit','delivered','completed','accepted_partial')
GROUP BY i.product_id
HAVING COALESCE(SUM(GREATEST(i.qty_ordered - i.qty_accepted - i.qty_damaged - i.qty_rejected, 0)), 0) > 0.0001`, buyerOrgID, locationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IncomingLine
	for rows.Next() {
		var line IncomingLine
		if err := rows.Scan(&line.ProductID, &line.Qty, &line.ExpectedAt); err != nil {
			return nil, err
		}
		out = append(out, line)
	}
	if out == nil {
		out = []IncomingLine{}
	}
	return out, rows.Err()
}

func (s *Store) AppointmentConsumption(ctx context.Context, appointmentID uuid.UUID) (map[uuid.UUID]float64, error) {
	rows, err := s.pool.Query(ctx, `
SELECT product_id, COALESCE(SUM(-qty), 0)::float8
FROM stock_movements
WHERE ref_type='appointment' AND ref_id=$1 AND kind='consumption'
GROUP BY product_id
HAVING COALESCE(SUM(-qty), 0) > 0.0001`, appointmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[uuid.UUID]float64{}
	for rows.Next() {
		var pid uuid.UUID
		var qty float64
		if err := rows.Scan(&pid, &qty); err != nil {
			return nil, err
		}
		out[pid] = qty
	}
	return out, rows.Err()
}

func (s *Store) AppointmentConsumptionByLocation(ctx context.Context, locationID, appointmentID uuid.UUID) (map[uuid.UUID]float64, error) {
	rows, err := s.pool.Query(ctx, `
SELECT product_id, COALESCE(SUM(-qty), 0)::float8
FROM stock_movements
WHERE location_id=$1 AND ref_type='appointment' AND ref_id=$2 AND kind='consumption'
GROUP BY product_id
HAVING COALESCE(SUM(-qty), 0) > 0.0001`, locationID, appointmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[uuid.UUID]float64{}
	for rows.Next() {
		var pid uuid.UUID
		var qty float64
		if err := rows.Scan(&pid, &qty); err != nil {
			return nil, err
		}
		out[pid] = qty
	}
	return out, rows.Err()
}

func (s *Store) ListProductsByIDs(ctx context.Context, ids []uuid.UUID) ([]domain.Product, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx, `SELECT `+productColumns+` FROM products WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Product
	for rows.Next() {
		p, err := scanProductRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
