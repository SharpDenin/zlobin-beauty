package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

type Store struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// --- stock locations ---

func (s *Store) CreateLocation(ctx context.Context, l domain.StockLocation) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO stock_locations(id, organization_id, name, kind, owner_user_id, created_at)
VALUES ($1,$2,$3,$4,$5,$6)`, l.ID, l.OrganizationID, l.Name, l.Kind, l.OwnerUserID, l.CreatedAt)
	return err
}

func (s *Store) GetLocation(ctx context.Context, id uuid.UUID) (*domain.StockLocation, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, organization_id, name, kind, owner_user_id, created_at
FROM stock_locations WHERE id=$1`, id)
	return scanLocation(row)
}

func (s *Store) ListLocations(ctx context.Context, orgID uuid.UUID) ([]domain.StockLocation, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, organization_id, name, kind, owner_user_id, created_at
FROM stock_locations WHERE organization_id=$1 ORDER BY created_at`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.StockLocation
	for rows.Next() {
		var l domain.StockLocation
		if err := rows.Scan(&l.ID, &l.OrganizationID, &l.Name, &l.Kind, &l.OwnerUserID, &l.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func scanLocation(row pgx.Row) (*domain.StockLocation, error) {
	var l domain.StockLocation
	if err := row.Scan(&l.ID, &l.OrganizationID, &l.Name, &l.Kind, &l.OwnerUserID, &l.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &l, nil
}

// --- products ---

const productColumns = `id, organization_id, parent_id, category_id, brand, name, sku, description, unit, volume_label, price_minor, currency, min_stock, published, for_sale, delivery_days, photo_media_id, created_at, updated_at`

func (s *Store) CreateProduct(ctx context.Context, p domain.Product) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO products(`+productColumns+`)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
		p.ID, p.OrganizationID, p.ParentID, p.CategoryID, p.Brand, p.Name, p.SKU, p.Description, p.Unit, p.VolumeLabel,
		p.PriceMinor, p.Currency, p.MinStock, p.Published, p.ForSale, p.DeliveryDays, p.PhotoMediaID, p.CreatedAt, p.UpdatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return apperr.Conflict("product with this sku already exists")
		}
		return err
	}
	return nil
}

func (s *Store) GetProduct(ctx context.Context, id uuid.UUID) (*domain.Product, error) {
	return scanProduct(s.pool.QueryRow(ctx, `SELECT `+productColumns+` FROM products WHERE id=$1`, id))
}

func (s *Store) ListProducts(ctx context.Context, orgID uuid.UUID) ([]domain.Product, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+productColumns+` FROM products WHERE organization_id=$1 ORDER BY created_at DESC`, orgID)
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

func (s *Store) UpdateProduct(ctx context.Context, p domain.Product) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE products SET parent_id=$2, category_id=$3, brand=$4, name=$5, sku=$6, description=$7, unit=$8, volume_label=$9,
  price_minor=$10, currency=$11, min_stock=$12, published=$13, for_sale=$14, delivery_days=$15, photo_media_id=$16, updated_at=$17
WHERE id=$1`,
		p.ID, p.ParentID, p.CategoryID, p.Brand, p.Name, p.SKU, p.Description, p.Unit, p.VolumeLabel,
		p.PriceMinor, p.Currency, p.MinStock, p.Published, p.ForSale, p.DeliveryDays, p.PhotoMediaID, p.UpdatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return apperr.Conflict("product with this sku already exists")
		}
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("product not found")
	}
	return nil
}

func scanProduct(row pgx.Row) (*domain.Product, error) {
	var p domain.Product
	if err := row.Scan(&p.ID, &p.OrganizationID, &p.ParentID, &p.CategoryID, &p.Brand, &p.Name, &p.SKU, &p.Description, &p.Unit, &p.VolumeLabel,
		&p.PriceMinor, &p.Currency, &p.MinStock, &p.Published, &p.ForSale, &p.DeliveryDays, &p.PhotoMediaID, &p.CreatedAt, &p.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

func scanProductRow(rows pgx.Rows) (*domain.Product, error) {
	var p domain.Product
	if err := rows.Scan(&p.ID, &p.OrganizationID, &p.ParentID, &p.CategoryID, &p.Brand, &p.Name, &p.SKU, &p.Description, &p.Unit, &p.VolumeLabel,
		&p.PriceMinor, &p.Currency, &p.MinStock, &p.Published, &p.ForSale, &p.DeliveryDays, &p.PhotoMediaID, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return nil, err
	}
	return &p, nil
}

// --- stock balances & movements ---

// applyMovementTx locks (or creates) the balance row for (location, product),
// applies the movement, then records it. For on-hand kinds (receipt, return,
// consumption, write_off, adjust) m.Qty is the signed delta on qty_on_hand
// (consumption/write_off are negative). For reserve/unreserve m.Qty is the
// positive amount; qty_before/qty_after track qty_reserved instead of on_hand.
func applyMovementTx(ctx context.Context, tx pgx.Tx, m domain.StockMovement) (domain.StockMovement, error) {
	var onHand, reserved float64
	err := tx.QueryRow(ctx, `
SELECT qty_on_hand, qty_reserved FROM stock_balances WHERE location_id=$1 AND product_id=$2 FOR UPDATE`,
		m.LocationID, m.ProductID).Scan(&onHand, &reserved)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return domain.StockMovement{}, err
		}
		onHand, reserved = 0, 0
	}

	switch m.Kind {
	case domain.MovementReserve:
		amount := m.Qty
		if amount <= 0 {
			return domain.StockMovement{}, apperr.Validation("qty must be positive for reserve")
		}
		if onHand-reserved < amount-1e-9 {
			return domain.StockMovement{}, apperr.Validation("insufficient stock at location")
		}
		m.QtyBefore = reserved
		reserved += amount
		m.QtyAfter = reserved
	case domain.MovementUnreserve:
		amount := m.Qty
		if amount <= 0 {
			return domain.StockMovement{}, apperr.Validation("qty must be positive for unreserve")
		}
		m.QtyBefore = reserved
		if amount > reserved {
			amount = reserved
		}
		reserved -= amount
		m.QtyAfter = reserved
		m.Qty = amount
	case domain.MovementReceipt, domain.MovementReturn:
		m.QtyBefore = onHand
		onHand += m.Qty
		if onHand < 0 {
			return domain.StockMovement{}, apperr.Validation("insufficient stock at location")
		}
		m.QtyAfter = onHand
	case domain.MovementConsumption, domain.MovementWriteOff:
		m.QtyBefore = onHand
		onHand += m.Qty
		if onHand < 0 || onHand-reserved < -1e-9 {
			return domain.StockMovement{}, apperr.Validation("insufficient stock at location")
		}
		m.QtyAfter = onHand
	case domain.MovementAdjust:
		m.QtyBefore = onHand
		onHand += m.Qty
		if onHand < 0 || onHand-reserved < -1e-9 {
			return domain.StockMovement{}, apperr.Validation("insufficient stock at location")
		}
		m.QtyAfter = onHand
	default:
		return domain.StockMovement{}, apperr.Validation("unknown movement kind")
	}

	if _, err := tx.Exec(ctx, `
INSERT INTO stock_balances(location_id, product_id, qty_on_hand, qty_reserved, updated_at)
VALUES ($1,$2,$3,$4,$5)
ON CONFLICT (location_id, product_id) DO UPDATE SET
  qty_on_hand=EXCLUDED.qty_on_hand, qty_reserved=EXCLUDED.qty_reserved, updated_at=EXCLUDED.updated_at`,
		m.LocationID, m.ProductID, onHand, reserved, m.CreatedAt); err != nil {
		return domain.StockMovement{}, err
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO stock_movements(id, location_id, product_id, kind, qty, qty_before, qty_after, reason, actor_user_id, ref_type, ref_id, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		m.ID, m.LocationID, m.ProductID, m.Kind, m.Qty, m.QtyBefore, m.QtyAfter, m.Reason, m.ActorUserID, m.RefType, m.RefID, m.CreatedAt); err != nil {
		return domain.StockMovement{}, err
	}
	return m, nil
}

// GetOrCreateLocationByKind returns the first stock location of kind for the
// organization, creating one with the given name when none exists.
func (s *Store) GetOrCreateLocationByKind(ctx context.Context, orgID uuid.UUID, kind, name string) (*domain.StockLocation, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, organization_id, name, kind, owner_user_id, created_at
FROM stock_locations WHERE organization_id=$1 AND kind=$2 ORDER BY created_at LIMIT 1`, orgID, kind)
	if l, err := scanLocation(row); err != nil {
		return nil, err
	} else if l != nil {
		return l, nil
	}
	now := time.Now().UTC()
	l := domain.StockLocation{
		ID: uuid.Must(uuid.NewV7()), OrganizationID: orgID, Name: name, Kind: kind, CreatedAt: now,
	}
	if err := s.CreateLocation(ctx, l); err != nil {
		return nil, err
	}
	return &l, nil
}

func (s *Store) CreateMovement(ctx context.Context, m domain.StockMovement) (*domain.StockMovement, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	out, err := applyMovementTx(ctx, tx, m)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *Store) ListBalancesByLocation(ctx context.Context, locationID uuid.UUID) ([]domain.StockBalanceView, error) {
	rows, err := s.pool.Query(ctx, `
SELECT sb.location_id, sb.product_id, sb.qty_on_hand, sb.qty_reserved, sb.updated_at,
       p.name, p.brand, p.sku, p.min_stock, p.price_minor, p.currency
FROM stock_balances sb
JOIN products p ON p.id = sb.product_id
WHERE sb.location_id=$1
ORDER BY p.name`, locationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.StockBalanceView
	for rows.Next() {
		var v domain.StockBalanceView
		if err := rows.Scan(&v.LocationID, &v.ProductID, &v.QtyOnHand, &v.QtyReserved, &v.UpdatedAt,
			&v.ProductName, &v.ProductBrand, &v.ProductSKU, &v.MinStock, &v.PriceMinor, &v.Currency); err != nil {
			return nil, err
		}
		v.Status = domain.StockStatus(v.QtyOnHand, v.QtyReserved, v.MinStock)
		out = append(out, v)
	}
	return out, rows.Err()
}

// --- consumption norms ---

func (s *Store) UpsertNorm(ctx context.Context, n domain.ConsumptionNorm) (*domain.ConsumptionNorm, error) {
	var out domain.ConsumptionNorm
	err := s.pool.QueryRow(ctx, `
INSERT INTO consumption_norms(id, organization_id, service_id, product_id, qty, required, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7)
ON CONFLICT (service_id, product_id) DO UPDATE SET qty=EXCLUDED.qty, required=EXCLUDED.required
RETURNING id, organization_id, service_id, product_id, qty, required, created_at`,
		n.ID, n.OrganizationID, n.ServiceID, n.ProductID, n.Qty, n.Required, n.CreatedAt,
	).Scan(&out.ID, &out.OrganizationID, &out.ServiceID, &out.ProductID, &out.Qty, &out.Required, &out.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *Store) HasMovementRef(ctx context.Context, refType string, refID uuid.UUID) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `
SELECT EXISTS(SELECT 1 FROM stock_movements WHERE ref_type=$1 AND ref_id=$2)`, refType, refID).Scan(&exists)
	return exists, err
}

// ResolveConsumptionLocation returns the salon stock location for an org,
// falling back to any location, then creating a default salon location.
func (s *Store) ResolveConsumptionLocation(ctx context.Context, orgID uuid.UUID) (*domain.StockLocation, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, organization_id, name, kind, owner_user_id, created_at
FROM stock_locations WHERE organization_id=$1 AND kind=$2 ORDER BY created_at LIMIT 1`, orgID, domain.LocationSalon)
	if l, err := scanLocation(row); err != nil {
		return nil, err
	} else if l != nil {
		return l, nil
	}
	row = s.pool.QueryRow(ctx, `
SELECT id, organization_id, name, kind, owner_user_id, created_at
FROM stock_locations WHERE organization_id=$1 ORDER BY created_at LIMIT 1`, orgID)
	if l, err := scanLocation(row); err != nil {
		return nil, err
	} else if l != nil {
		return l, nil
	}
	return s.GetOrCreateLocationByKind(ctx, orgID, domain.LocationSalon, "Склад салона")
}

// ConsumeAppointmentNorms applies consumption movements for all norms in one transaction.
func (s *Store) ConsumeAppointmentNorms(ctx context.Context, locationID uuid.UUID, norms []domain.ConsumptionNorm, appointmentID, actorUserID uuid.UUID, now time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	refID := appointmentID
	for _, n := range norms {
		mv := domain.StockMovement{
			ID: uuid.Must(uuid.NewV7()), LocationID: locationID, ProductID: n.ProductID,
			Kind: domain.MovementConsumption, Qty: -n.Qty, Reason: "Норма расхода по услуге",
			ActorUserID: actorUserID, RefType: "appointment", RefID: &refID, CreatedAt: now,
		}
		if _, err := applyMovementTx(ctx, tx, mv); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) ListNorms(ctx context.Context, orgID uuid.UUID, serviceID *uuid.UUID) ([]domain.ConsumptionNorm, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, organization_id, service_id, product_id, qty, required, created_at
FROM consumption_norms
WHERE organization_id=$1 AND ($2::uuid IS NULL OR service_id=$2)
ORDER BY created_at DESC`, orgID, serviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ConsumptionNorm
	for rows.Next() {
		var n domain.ConsumptionNorm
		if err := rows.Scan(&n.ID, &n.OrganizationID, &n.ServiceID, &n.ProductID, &n.Qty, &n.Required, &n.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// --- supplier orders ---

const orderColumns = `id, buyer_org_id, supplier_org_id, location_id, status, currency, total_minor, comment,
desired_at, estimated_delivery_at, created_by, created_at, updated_at,
destination_branch_id, payment_method, payment_status, subtotal_minor, delivery_cost_minor, paid_at, idempotency_key`

const orderItemColumns = `id, order_id, product_id, qty_ordered, qty_delivered, qty_accepted, price_minor, product_name, product_sku`

const deliveryColumns = `id, order_id, supplier_org_id, destination_branch_id, status,
planned_delivery_at, window_start, window_end, delivered_at,
recipient_name, recipient_phone, comment, provider, tracking_code, created_at, updated_at`

func (s *Store) CreateOrder(ctx context.Context, o domain.SupplierOrder, items []domain.SupplierOrderItem, delivery *domain.OrderDelivery) (*domain.SupplierOrder, []domain.SupplierOrderItem, *domain.OrderDelivery, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
INSERT INTO supplier_orders(`+orderColumns+`)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
		o.ID, o.BuyerOrgID, o.SupplierOrgID, o.LocationID, o.Status, o.Currency, o.TotalMinor, o.Comment,
		o.DesiredAt, o.EstimatedDeliveryAt, o.CreatedBy, o.CreatedAt, o.UpdatedAt,
		o.DestinationBranchID, o.PaymentMethod, o.PaymentStatus, o.SubtotalMinor, o.DeliveryCostMinor, o.PaidAt, nullIfEmpty(o.IdempotencyKey)); err != nil {
		return nil, nil, nil, err
	}
	for i := range items {
		items[i].OrderID = o.ID
		if _, err := tx.Exec(ctx, `
INSERT INTO supplier_order_items(id, order_id, product_id, qty_ordered, qty_delivered, qty_accepted, price_minor, product_name, product_sku)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			items[i].ID, items[i].OrderID, items[i].ProductID, items[i].QtyOrdered, items[i].QtyDelivered, items[i].QtyAccepted,
			items[i].PriceMinor, items[i].ProductName, items[i].ProductSKU); err != nil {
			return nil, nil, nil, err
		}
	}
	if delivery != nil {
		delivery.OrderID = o.ID
		if _, err := tx.Exec(ctx, `
INSERT INTO order_deliveries(`+deliveryColumns+`)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
			delivery.ID, delivery.OrderID, delivery.SupplierOrgID, delivery.DestinationBranchID, delivery.Status,
			delivery.PlannedDeliveryAt, delivery.WindowStart, delivery.WindowEnd, delivery.DeliveredAt,
			delivery.RecipientName, delivery.RecipientPhone, delivery.Comment, delivery.Provider, delivery.TrackingCode,
			delivery.CreatedAt, delivery.UpdatedAt); err != nil {
			return nil, nil, nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, nil, err
	}
	return &o, items, delivery, nil
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s *Store) GetOrder(ctx context.Context, id uuid.UUID) (*domain.SupplierOrder, error) {
	return scanOrder(s.pool.QueryRow(ctx, `SELECT `+orderColumns+` FROM supplier_orders WHERE id=$1`, id))
}

func (s *Store) GetOrderByIdempotencyKey(ctx context.Context, createdBy uuid.UUID, key string) (*domain.SupplierOrder, error) {
	if key == "" {
		return nil, nil
	}
	return scanOrder(s.pool.QueryRow(ctx, `
SELECT `+orderColumns+` FROM supplier_orders WHERE created_by=$1 AND idempotency_key=$2`, createdBy, key))
}

func (s *Store) ListOrderItems(ctx context.Context, orderID uuid.UUID) ([]domain.SupplierOrderItem, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+orderItemColumns+`
FROM supplier_order_items WHERE order_id=$1 ORDER BY id`, orderID)
	if err != nil {
		return nil, err
	}
	return scanOrderItems(rows)
}

func (s *Store) ListOrders(ctx context.Context, orgID uuid.UUID, asSupplier bool) ([]domain.SupplierOrder, error) {
	col := "buyer_org_id"
	if asSupplier {
		col = "supplier_org_id"
	}
	rows, err := s.pool.Query(ctx, `SELECT `+orderColumns+` FROM supplier_orders WHERE `+col+`=$1 ORDER BY created_at DESC`, orgID)
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
	return out, rows.Err()
}

// CountOrdersInRange counts distinct supplier orders created in [from, to) for a supplier org.
func (s *Store) CountOrdersInRange(ctx context.Context, supplierOrgID uuid.UUID, from, to time.Time) (int64, error) {
	var n int64
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM supplier_orders WHERE supplier_org_id=$1 AND created_at >= $2 AND created_at < $3`,
		supplierOrgID, from, to).Scan(&n)
	return n, err
}

// TurnoverInRange sums price_minor*qty_accepted for accepted orders of a
// supplier whose updated_at falls in [from, to).
func (s *Store) TurnoverInRange(ctx context.Context, supplierOrgID uuid.UUID, from, to time.Time) (int64, error) {
	var total int64
	err := s.pool.QueryRow(ctx, `
SELECT COALESCE(ROUND(SUM(soi.price_minor * soi.qty_accepted)), 0)::bigint
FROM supplier_order_items soi
JOIN supplier_orders so ON so.id = soi.order_id
WHERE so.supplier_org_id=$1
  AND so.status IN ('accepted_partial', 'accepted_full')
  AND so.updated_at >= $2 AND so.updated_at < $3`,
		supplierOrgID, from, to).Scan(&total)
	return total, err
}

func (s *Store) CountProducts(ctx context.Context, orgID uuid.UUID) (int64, error) {
	var n int64
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM products WHERE organization_id=$1`, orgID).Scan(&n)
	return n, err
}

// CountCriticalSupplierStock counts stock balances at the supplier's own
// ("supplier"-kind) locations that are at or below the low-stock threshold.
func (s *Store) CountCriticalSupplierStock(ctx context.Context, orgID uuid.UUID) (int64, error) {
	var n int64
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*)
FROM stock_balances sb
JOIN stock_locations sl ON sl.id = sb.location_id
JOIN products p ON p.id = sb.product_id
WHERE sl.organization_id=$1 AND sl.kind='supplier'
  AND (
    (p.min_stock > 0 AND (sb.qty_on_hand - sb.qty_reserved) <= p.min_stock)
    OR (p.min_stock = 0 AND (sb.qty_on_hand - sb.qty_reserved) <= 0)
  )`, orgID).Scan(&n)
	return n, err
}

func (s *Store) UpdateOrderStatus(ctx context.Context, id uuid.UUID, status string, now time.Time, estimatedDeliveryAt *time.Time) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE supplier_orders
SET status=$2,
    estimated_delivery_at=COALESCE($4, estimated_delivery_at),
    updated_at=$3
WHERE id=$1`, id, status, now, estimatedDeliveryAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("order not found")
	}
	return nil
}

func (s *Store) MarkOrderPaid(ctx context.Context, id uuid.UUID, paidAt, now time.Time) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE supplier_orders
SET payment_status=$2, paid_at=$3, updated_at=$4
WHERE id=$1`, id, domain.PaymentStatusPaid, paidAt, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("order not found")
	}
	return nil
}

func (s *Store) ConfirmOrder(ctx context.Context, id uuid.UUID, now time.Time) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE supplier_orders SET status='confirmed', updated_at=$2 WHERE id=$1 AND status IN ('new', 'submitted')`, id, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.Conflict("order is not in a confirmable state")
	}
	return nil
}

// AcceptItem describes the quantity accepted in this acceptance action for
// one order line matched by product_id (a delta added on top of any previously accepted qty).
type AcceptItem struct {
	ProductID uuid.UUID
	QtyDiff   float64
}

// AcceptOrder applies accepted quantities to order items, creates receipt
// stock movements at the order's location for each accepted delta, and
// recomputes the order status (accepted_partial or accepted_full) based on
// total accepted vs total ordered across all items.
func (s *Store) AcceptOrder(ctx context.Context, orderID, actorUserID uuid.UUID, accept []AcceptItem, now time.Time) (*domain.SupplierOrder, []domain.SupplierOrderItem, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)

	var order domain.SupplierOrder
	var idem *string
	if err := tx.QueryRow(ctx, `SELECT `+orderColumns+` FROM supplier_orders WHERE id=$1 FOR UPDATE`, orderID).Scan(
		&order.ID, &order.BuyerOrgID, &order.SupplierOrgID, &order.LocationID, &order.Status, &order.Currency,
		&order.TotalMinor, &order.Comment, &order.DesiredAt, &order.EstimatedDeliveryAt, &order.CreatedBy, &order.CreatedAt, &order.UpdatedAt,
		&order.DestinationBranchID, &order.PaymentMethod, &order.PaymentStatus, &order.SubtotalMinor, &order.DeliveryCostMinor,
		&order.PaidAt, &idem); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, apperr.NotFound("order not found")
		}
		return nil, nil, err
	}
	if idem != nil {
		order.IdempotencyKey = *idem
	}

	if order.Status != domain.OrderStatusDelivered && order.Status != domain.OrderStatusCompleted && order.Status != domain.OrderStatusAcceptedPartial {
		return nil, nil, apperr.Conflict("order is not ready to be accepted")
	}

	rows, err := tx.Query(ctx, `
SELECT `+orderItemColumns+`
FROM supplier_order_items WHERE order_id=$1 FOR UPDATE`, orderID)
	if err != nil {
		return nil, nil, err
	}
	items, err := scanOrderItems(rows)
	if err != nil {
		return nil, nil, err
	}

	byProduct := make(map[uuid.UUID]*domain.SupplierOrderItem, len(items))
	for i := range items {
		byProduct[items[i].ProductID] = &items[i]
	}
	for _, a := range accept {
		item, ok := byProduct[a.ProductID]
		if !ok {
			return nil, nil, apperr.Validation("product does not belong to this order")
		}
		newAccepted := item.QtyAccepted + a.QtyDiff
		if newAccepted > item.QtyOrdered+1e-9 {
			return nil, nil, apperr.Validation("accepted quantity exceeds ordered quantity")
		}
		item.QtyAccepted = newAccepted
		item.QtyDelivered = newAccepted
		if _, err := tx.Exec(ctx, `UPDATE supplier_order_items SET qty_accepted=$2, qty_delivered=$3 WHERE id=$1`,
			item.ID, item.QtyAccepted, item.QtyDelivered); err != nil {
			return nil, nil, err
		}
		mv := domain.StockMovement{
			ID: uuid.Must(uuid.NewV7()), LocationID: order.LocationID, ProductID: item.ProductID,
			Kind: domain.MovementReceipt, Qty: a.QtyDiff, Reason: "supplier order acceptance",
			ActorUserID: actorUserID, RefType: "supplier_order", RefID: &order.ID, CreatedAt: now,
		}
		if _, err := applyMovementTx(ctx, tx, mv); err != nil {
			return nil, nil, err
		}
	}

	full := true
	anyAccepted := false
	for _, it := range items {
		if it.QtyAccepted > 1e-9 {
			anyAccepted = true
		}
		if it.QtyAccepted+1e-9 < it.QtyOrdered {
			full = false
		}
	}
	status := order.Status
	switch {
	case full:
		status = domain.OrderStatusAcceptedFull
	case anyAccepted:
		status = domain.OrderStatusAcceptedPartial
	}
	if _, err := tx.Exec(ctx, `UPDATE supplier_orders SET status=$2, updated_at=$3 WHERE id=$1`, order.ID, status, now); err != nil {
		return nil, nil, err
	}
	order.Status = status
	order.UpdatedAt = now

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	return &order, items, nil
}

func scanOrder(row pgx.Row) (*domain.SupplierOrder, error) {
	var o domain.SupplierOrder
	var idem *string
	if err := row.Scan(&o.ID, &o.BuyerOrgID, &o.SupplierOrgID, &o.LocationID, &o.Status, &o.Currency,
		&o.TotalMinor, &o.Comment, &o.DesiredAt, &o.EstimatedDeliveryAt, &o.CreatedBy, &o.CreatedAt, &o.UpdatedAt,
		&o.DestinationBranchID, &o.PaymentMethod, &o.PaymentStatus, &o.SubtotalMinor, &o.DeliveryCostMinor,
		&o.PaidAt, &idem); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if idem != nil {
		o.IdempotencyKey = *idem
	}
	return &o, nil
}

func scanOrderRow(rows pgx.Rows) (*domain.SupplierOrder, error) {
	var o domain.SupplierOrder
	var idem *string
	if err := rows.Scan(&o.ID, &o.BuyerOrgID, &o.SupplierOrgID, &o.LocationID, &o.Status, &o.Currency,
		&o.TotalMinor, &o.Comment, &o.DesiredAt, &o.EstimatedDeliveryAt, &o.CreatedBy, &o.CreatedAt, &o.UpdatedAt,
		&o.DestinationBranchID, &o.PaymentMethod, &o.PaymentStatus, &o.SubtotalMinor, &o.DeliveryCostMinor,
		&o.PaidAt, &idem); err != nil {
		return nil, err
	}
	if idem != nil {
		o.IdempotencyKey = *idem
	}
	return &o, nil
}

func scanOrderItems(rows pgx.Rows) ([]domain.SupplierOrderItem, error) {
	defer rows.Close()
	var out []domain.SupplierOrderItem
	for rows.Next() {
		var it domain.SupplierOrderItem
		if err := rows.Scan(&it.ID, &it.OrderID, &it.ProductID, &it.QtyOrdered, &it.QtyDelivered, &it.QtyAccepted,
			&it.PriceMinor, &it.ProductName, &it.ProductSKU); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// --- order deliveries ---

func (s *Store) GetDeliveryByOrderID(ctx context.Context, orderID uuid.UUID) (*domain.OrderDelivery, error) {
	return scanDelivery(s.pool.QueryRow(ctx, `
SELECT `+deliveryColumns+`
FROM order_deliveries
WHERE order_id=$1 AND status NOT IN ('cancelled', 'failed')
ORDER BY created_at DESC
LIMIT 1`, orderID))
}

func (s *Store) GetDelivery(ctx context.Context, id uuid.UUID) (*domain.OrderDelivery, error) {
	return scanDelivery(s.pool.QueryRow(ctx, `SELECT `+deliveryColumns+` FROM order_deliveries WHERE id=$1`, id))
}

func (s *Store) UpdateDelivery(ctx context.Context, d domain.OrderDelivery) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE order_deliveries SET
  destination_branch_id=$2, status=$3, planned_delivery_at=$4, window_start=$5, window_end=$6,
  delivered_at=$7, recipient_name=$8, recipient_phone=$9, comment=$10, provider=$11, tracking_code=$12, updated_at=$13
WHERE id=$1`,
		d.ID, d.DestinationBranchID, d.Status, d.PlannedDeliveryAt, d.WindowStart, d.WindowEnd,
		d.DeliveredAt, d.RecipientName, d.RecipientPhone, d.Comment, d.Provider, d.TrackingCode, d.UpdatedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("delivery not found")
	}
	return nil
}

// CompleteDelivery marks delivery delivered and order completed in one transaction.
func (s *Store) CompleteDelivery(ctx context.Context, deliveryID, orderID uuid.UUID, deliveredAt, now time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `
UPDATE order_deliveries SET status=$2, delivered_at=$3, updated_at=$4 WHERE id=$1`,
		deliveryID, domain.DeliveryStatusDelivered, deliveredAt, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("delivery not found")
	}
	if _, err := tx.Exec(ctx, `
UPDATE supplier_orders SET status=$2, estimated_delivery_at=COALESCE(estimated_delivery_at, $3), updated_at=$4 WHERE id=$1`,
		orderID, domain.OrderStatusCompleted, deliveredAt, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func scanDelivery(row pgx.Row) (*domain.OrderDelivery, error) {
	var d domain.OrderDelivery
	if err := row.Scan(
		&d.ID, &d.OrderID, &d.SupplierOrgID, &d.DestinationBranchID, &d.Status,
		&d.PlannedDeliveryAt, &d.WindowStart, &d.WindowEnd, &d.DeliveredAt,
		&d.RecipientName, &d.RecipientPhone, &d.Comment, &d.Provider, &d.TrackingCode,
		&d.CreatedAt, &d.UpdatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &d, nil
}

// --- product categories ---

const productCategoryCols = `id, name, slug, created_at`

func (s *Store) ListProductCategories(ctx context.Context) ([]domain.ProductCategory, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+productCategoryCols+` FROM product_categories ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ProductCategory
	for rows.Next() {
		var c domain.ProductCategory
		if err := rows.Scan(&c.ID, &c.Name, &c.Slug, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) CreateProductCategory(ctx context.Context, c domain.ProductCategory) (*domain.ProductCategory, error) {
	var out domain.ProductCategory
	err := s.pool.QueryRow(ctx, `
INSERT INTO product_categories(id, name, slug, created_at)
VALUES ($1,$2,$3,$4)
RETURNING `+productCategoryCols,
		c.ID, c.Name, c.Slug, c.CreatedAt,
	).Scan(&out.ID, &out.Name, &out.Slug, &out.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *Store) UpdateProductCategory(ctx context.Context, c domain.ProductCategory) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE product_categories SET name=$2, slug=$3 WHERE id=$1`,
		c.ID, c.Name, c.Slug)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("product category not found")
	}
	return nil
}

func (s *Store) DeleteProductCategory(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM product_categories WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("product category not found")
	}
	return nil
}

// --- units of measure ---

const unitCols = `id, code, name, created_at`

func (s *Store) ListUnits(ctx context.Context) ([]domain.UnitOfMeasure, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+unitCols+` FROM units_of_measure ORDER BY code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.UnitOfMeasure
	for rows.Next() {
		var u domain.UnitOfMeasure
		if err := rows.Scan(&u.ID, &u.Code, &u.Name, &u.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) CreateUnit(ctx context.Context, u domain.UnitOfMeasure) (*domain.UnitOfMeasure, error) {
	var out domain.UnitOfMeasure
	err := s.pool.QueryRow(ctx, `
INSERT INTO units_of_measure(id, code, name, created_at)
VALUES ($1,$2,$3,$4)
RETURNING `+unitCols,
		u.ID, u.Code, u.Name, u.CreatedAt,
	).Scan(&out.ID, &out.Code, &out.Name, &out.CreatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, apperr.Conflict("unit already exists")
		}
		return nil, err
	}
	return &out, nil
}

func (s *Store) UpdateUnit(ctx context.Context, u domain.UnitOfMeasure) error {
	tag, err := s.pool.Exec(ctx, `UPDATE units_of_measure SET code=$2, name=$3 WHERE id=$1`, u.ID, u.Code, u.Name)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return apperr.Conflict("unit already exists")
		}
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("unit not found")
	}
	return nil
}

func (s *Store) DeleteUnit(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM units_of_measure WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("unit not found")
	}
	return nil
}
