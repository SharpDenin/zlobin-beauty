package store

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

const clientOrderColumns = `id, user_id, supplier_org_id, status, currency, total_minor, delivery_address, delivery_comment, payment_method, rep_user_id, delivered_at, delivery_note, amount_collected_minor, created_at, updated_at, pickup_branch_id, payment_status, idempotency_key`

const availableSubquery = `
COALESCE((
  SELECT SUM(sb.qty_on_hand - sb.qty_reserved)
  FROM stock_balances sb
  JOIN stock_locations sl ON sl.id = sb.location_id
  WHERE sb.product_id = p.id AND sl.organization_id = p.organization_id AND sl.kind = 'supplier'
), 0)`

// --- published catalog ---

func (s *Store) ListPublishedProducts(ctx context.Context, q, brand string, limit int) ([]domain.ShopProduct, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `
SELECT `+productColumns+`, `+availableSubquery+` AS available
FROM products p
WHERE p.published = true
  AND p.for_sale = true
  AND p.parent_id IS NULL
  AND p.archived_at IS NULL
  AND ($1 = '' OR p.name ILIKE '%' || $1 || '%' OR p.brand ILIKE '%' || $1 || '%')
  AND ($2 = '' OR p.brand ILIKE $2)
ORDER BY p.created_at DESC
LIMIT $3`, q, brand, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanShopProducts(rows)
}

func (s *Store) GetPublishedProduct(ctx context.Context, id uuid.UUID) (*domain.ShopProduct, error) {
	row := s.pool.QueryRow(ctx, `
SELECT `+productColumns+`, `+availableSubquery+` AS available
FROM products p
WHERE p.id = $1 AND p.published = true AND p.for_sale = true`, id)
	return scanShopProduct(row)
}

func (s *Store) ProductAvailable(ctx context.Context, productID uuid.UUID) (float64, error) {
	var available float64
	err := s.pool.QueryRow(ctx, `
SELECT COALESCE(SUM(sb.qty_on_hand - sb.qty_reserved), 0)
FROM stock_balances sb
JOIN stock_locations sl ON sl.id = sb.location_id
JOIN products p ON p.id = sb.product_id
WHERE sb.product_id = $1 AND sl.organization_id = p.organization_id AND sl.kind = 'supplier'`, productID).Scan(&available)
	return available, err
}

func scanShopProduct(row pgx.Row) (*domain.ShopProduct, error) {
	var sp domain.ShopProduct
	if err := row.Scan(&sp.ID, &sp.OrganizationID, &sp.ParentID, &sp.CategoryID, &sp.Brand, &sp.Name, &sp.SKU, &sp.Description, &sp.Unit, &sp.VolumeLabel,
		&sp.PriceMinor, &sp.Currency, &sp.MinStock, &sp.Published, &sp.ForSale, &sp.DeliveryDays, &sp.PhotoMediaID, &sp.Audience, &sp.ArchivedAt, &sp.CreatedAt, &sp.UpdatedAt, &sp.Available); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &sp, nil
}

func scanShopProducts(rows pgx.Rows) ([]domain.ShopProduct, error) {
	var out []domain.ShopProduct
	for rows.Next() {
		var sp domain.ShopProduct
		if err := rows.Scan(&sp.ID, &sp.OrganizationID, &sp.ParentID, &sp.CategoryID, &sp.Brand, &sp.Name, &sp.SKU, &sp.Description, &sp.Unit, &sp.VolumeLabel,
			&sp.PriceMinor, &sp.Currency, &sp.MinStock, &sp.Published, &sp.ForSale, &sp.DeliveryDays, &sp.PhotoMediaID, &sp.Audience, &sp.ArchivedAt, &sp.CreatedAt, &sp.UpdatedAt, &sp.Available); err != nil {
			return nil, err
		}
		out = append(out, sp)
	}
	return out, rows.Err()
}

// ListPublishedVariants returns the product family: root + all published children.
func (s *Store) ListPublishedVariants(ctx context.Context, productID uuid.UUID) ([]domain.ShopProduct, error) {
	p, err := s.GetPublishedProduct(ctx, productID)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, nil
	}
	rootID := p.ID
	if p.ParentID != nil {
		rootID = *p.ParentID
	}
	rows, err := s.pool.Query(ctx, `
SELECT `+productColumns+`, `+availableSubquery+` AS available
FROM products p
WHERE p.published = true
  AND p.for_sale = true
  AND (p.id = $1 OR p.parent_id = $1)
ORDER BY p.volume_label ASC NULLS LAST, p.price_minor ASC, p.created_at ASC`, rootID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanShopProducts(rows)
}

// --- client cart ---

func (s *Store) GetOrCreateCart(ctx context.Context, userID uuid.UUID, now time.Time) (*domain.ClientCart, error) {
	var c domain.ClientCart
	err := s.pool.QueryRow(ctx, `
SELECT id, user_id, updated_at, created_at FROM client_carts WHERE user_id = $1`, userID).Scan(
		&c.ID, &c.UserID, &c.UpdatedAt, &c.CreatedAt)
	if err == nil {
		return &c, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	c = domain.ClientCart{ID: uuid.Must(uuid.NewV7()), UserID: userID, UpdatedAt: now, CreatedAt: now}
	_, err = s.pool.Exec(ctx, `
INSERT INTO client_carts(id, user_id, updated_at, created_at) VALUES ($1,$2,$3,$4)`, c.ID, c.UserID, c.UpdatedAt, c.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *Store) ListCartItems(ctx context.Context, cartID uuid.UUID) ([]domain.ClientCartItem, error) {
	rows, err := s.pool.Query(ctx, `
SELECT ci.cart_id, ci.product_id, ci.qty,
       p.brand, p.name, p.sku, p.unit, COALESCE(ci.price_minor, p.price_minor), p.price_minor, p.currency, p.organization_id,
       `+availableSubquery+` AS available
FROM client_cart_items ci
JOIN products p ON p.id = ci.product_id
WHERE ci.cart_id = $1
ORDER BY p.name`, cartID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ClientCartItem
	for rows.Next() {
		var it domain.ClientCartItem
		if err := rows.Scan(&it.CartID, &it.ProductID, &it.Qty, &it.Brand, &it.Name, &it.SKU, &it.Unit,
			&it.CartPriceMinor, &it.CurrentPriceMinor, &it.Currency, &it.OrganizationID, &it.Available); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

func (s *Store) UpsertCartItem(ctx context.Context, cartID, productID uuid.UUID, qty float64, priceMinor int64, now time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
INSERT INTO client_cart_items(cart_id, product_id, qty, price_minor) VALUES ($1,$2,$3,$4)
ON CONFLICT (cart_id, product_id) DO UPDATE SET qty = EXCLUDED.qty, price_minor = EXCLUDED.price_minor`, cartID, productID, qty, priceMinor); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE client_carts SET updated_at=$2 WHERE id=$1`, cartID, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) RemoveCartItem(ctx context.Context, cartID, productID uuid.UUID, now time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM client_cart_items WHERE cart_id=$1 AND product_id=$2`, cartID, productID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE client_carts SET updated_at=$2 WHERE id=$1`, cartID, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) ClearCart(ctx context.Context, cartID uuid.UUID, now time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM client_cart_items WHERE cart_id=$1`, cartID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE client_carts SET updated_at=$2 WHERE id=$1`, cartID, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// --- client orders ---

type CreateClientOrderParams struct {
	Order       domain.ClientOrder
	Items       []domain.ClientOrderItem
	History     domain.ClientOrderStatusHistory
	ClearCartID uuid.UUID
	ActorUserID uuid.UUID
}

func (s *Store) CreateClientOrderWithItems(ctx context.Context, p CreateClientOrderParams) (*domain.ClientOrder, []domain.ClientOrderItem, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)
	o := p.Order
	if _, err := tx.Exec(ctx, `
INSERT INTO client_orders(`+clientOrderColumns+`)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
		o.ID, o.UserID, o.SupplierOrgID, o.Status, o.Currency, o.TotalMinor, o.DeliveryAddress, o.DeliveryComment,
		o.PaymentMethod, o.RepUserID, o.DeliveredAt, o.DeliveryNote, o.AmountCollectedMinor, o.CreatedAt, o.UpdatedAt, o.PickupBranchID, o.PaymentStatus, o.IdempotencyKey); err != nil {
		return nil, nil, err
	}
	items := p.Items
	for i := range items {
		items[i].OrderID = o.ID
		if _, err := tx.Exec(ctx, `
INSERT INTO client_order_items(id, order_id, product_id, product_name, brand, qty, price_minor, qty_delivered)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			items[i].ID, items[i].OrderID, items[i].ProductID, items[i].ProductName, items[i].Brand,
			items[i].Qty, items[i].PriceMinor, items[i].QtyDelivered); err != nil {
			return nil, nil, err
		}
	}
	locID, err := resolveSupplierLocationTx(ctx, tx, o.SupplierOrgID, o.CreatedAt)
	if err != nil {
		return nil, nil, err
	}
	actor := p.ActorUserID
	if actor == uuid.Nil {
		actor = o.UserID
	}
	orderRef := o.ID
	for _, it := range items {
		mv := domain.StockMovement{
			ID: uuid.Must(uuid.NewV7()), LocationID: locID, ProductID: it.ProductID,
			Kind: domain.MovementReserve, Qty: it.Qty, Reason: "client order checkout",
			ActorUserID: actor, RefType: "client_order", RefID: &orderRef, CreatedAt: o.CreatedAt,
		}
		if _, err := applyMovementTx(ctx, tx, mv); err != nil {
			return nil, nil, err
		}
	}
	if err := appendStatusHistoryTx(ctx, tx, p.History); err != nil {
		return nil, nil, err
	}
	if p.ClearCartID != uuid.Nil {
		if _, err := tx.Exec(ctx, `DELETE FROM client_cart_items WHERE cart_id=$1`, p.ClearCartID); err != nil {
			return nil, nil, err
		}
		if _, err := tx.Exec(ctx, `UPDATE client_carts SET updated_at=$2 WHERE id=$1`, p.ClearCartID, o.UpdatedAt); err != nil {
			return nil, nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	return &o, items, nil
}

// resolveSupplierLocationTx picks the supplier stock location for an org:
// first kind=supplier, else any location, else creates supplier "Склад поставщика".
func resolveSupplierLocationTx(ctx context.Context, tx pgx.Tx, orgID uuid.UUID, now time.Time) (uuid.UUID, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, `
SELECT id FROM stock_locations WHERE organization_id=$1 AND kind=$2 ORDER BY created_at LIMIT 1`,
		orgID, domain.LocationSupplier).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}
	err = tx.QueryRow(ctx, `
SELECT id FROM stock_locations WHERE organization_id=$1 ORDER BY created_at LIMIT 1`, orgID).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}
	id = uuid.Must(uuid.NewV7())
	if _, err := tx.Exec(ctx, `
INSERT INTO stock_locations(id, organization_id, name, kind, owner_user_id, created_at)
VALUES ($1,$2,$3,$4,$5,$6)`, id, orgID, "Склад поставщика", domain.LocationSupplier, nil, now); err != nil {
		return uuid.Nil, err
	}
	return id, nil
}

func appendStatusHistoryTx(ctx context.Context, tx pgx.Tx, h domain.ClientOrderStatusHistory) error {
	_, err := tx.Exec(ctx, `
INSERT INTO client_order_status_history(id, order_id, from_status, to_status, actor_user_id, note, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		h.ID, h.OrderID, h.FromStatus, h.ToStatus, h.ActorUserID, h.Note, h.CreatedAt)
	return err
}

func (s *Store) AppendStatusHistory(ctx context.Context, h domain.ClientOrderStatusHistory) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO client_order_status_history(id, order_id, from_status, to_status, actor_user_id, note, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		h.ID, h.OrderID, h.FromStatus, h.ToStatus, h.ActorUserID, h.Note, h.CreatedAt)
	return err
}

func (s *Store) ListClientOrdersByUser(ctx context.Context, userID uuid.UUID) ([]domain.ClientOrder, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+clientOrderColumns+` FROM client_orders WHERE user_id=$1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	return scanClientOrders(rows)
}

func (s *Store) ListClientOrdersBySupplier(ctx context.Context, supplierOrgID uuid.UUID, status string) ([]domain.ClientOrder, error) {
	q := `SELECT ` + clientOrderColumns + ` FROM client_orders WHERE supplier_org_id=$1`
	args := []any{supplierOrgID}
	if status != "" {
		q += ` AND status=$2`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC`
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	return scanClientOrders(rows)
}

func (s *Store) GetClientOrder(ctx context.Context, id uuid.UUID) (*domain.ClientOrder, error) {
	return scanClientOrder(s.pool.QueryRow(ctx, `SELECT `+clientOrderColumns+` FROM client_orders WHERE id=$1`, id))
}

func (s *Store) GetClientOrderByIdempotencyKey(ctx context.Context, userID uuid.UUID, key string) (*domain.ClientOrder, error) {
	if strings.TrimSpace(key) == "" {
		return nil, nil
	}
	return scanClientOrder(s.pool.QueryRow(ctx, `
SELECT `+clientOrderColumns+` FROM client_orders WHERE user_id=$1 AND idempotency_key=$2`, userID, key))
}

func (s *Store) ListClientOrderStatusHistory(ctx context.Context, orderID uuid.UUID) ([]domain.ClientOrderStatusHistory, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, order_id, from_status, to_status, actor_user_id, note, created_at
FROM client_order_status_history WHERE order_id=$1 ORDER BY created_at ASC`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ClientOrderStatusHistory
	for rows.Next() {
		var h domain.ClientOrderStatusHistory
		if err := rows.Scan(&h.ID, &h.OrderID, &h.FromStatus, &h.ToStatus, &h.ActorUserID, &h.Note, &h.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

func (s *Store) ListClientOrderItems(ctx context.Context, orderID uuid.UUID) ([]domain.ClientOrderItem, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, order_id, product_id, product_name, brand, qty, price_minor, qty_delivered
FROM client_order_items WHERE order_id=$1 ORDER BY id`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ClientOrderItem
	for rows.Next() {
		var it domain.ClientOrderItem
		if err := rows.Scan(&it.ID, &it.OrderID, &it.ProductID, &it.ProductName, &it.Brand, &it.Qty, &it.PriceMinor, &it.QtyDelivered); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

func scanClientOrder(row pgx.Row) (*domain.ClientOrder, error) {
	var o domain.ClientOrder
	if err := row.Scan(&o.ID, &o.UserID, &o.SupplierOrgID, &o.Status, &o.Currency, &o.TotalMinor,
		&o.DeliveryAddress, &o.DeliveryComment, &o.PaymentMethod, &o.RepUserID, &o.DeliveredAt,
		&o.DeliveryNote, &o.AmountCollectedMinor, &o.CreatedAt, &o.UpdatedAt, &o.PickupBranchID, &o.PaymentStatus, &o.IdempotencyKey); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &o, nil
}

func scanClientOrders(rows pgx.Rows) ([]domain.ClientOrder, error) {
	defer rows.Close()
	var out []domain.ClientOrder
	for rows.Next() {
		o, err := scanClientOrderRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *o)
	}
	return out, rows.Err()
}

func scanClientOrderRow(rows pgx.Rows) (*domain.ClientOrder, error) {
	var o domain.ClientOrder
	if err := rows.Scan(&o.ID, &o.UserID, &o.SupplierOrgID, &o.Status, &o.Currency, &o.TotalMinor,
		&o.DeliveryAddress, &o.DeliveryComment, &o.PaymentMethod, &o.RepUserID, &o.DeliveredAt,
		&o.DeliveryNote, &o.AmountCollectedMinor, &o.CreatedAt, &o.UpdatedAt, &o.PickupBranchID, &o.PaymentStatus, &o.IdempotencyKey); err != nil {
		return nil, err
	}
	return &o, nil
}

func (s *Store) UpdateClientOrderStatus(ctx context.Context, id uuid.UUID, status string, now time.Time) error {
	tag, err := s.pool.Exec(ctx, `UPDATE client_orders SET status=$2, updated_at=$3 WHERE id=$1`, id, status, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("order not found")
	}
	return nil
}

func (s *Store) AssignRep(ctx context.Context, id uuid.UUID, repUserID uuid.UUID, now time.Time) error {
	tag, err := s.pool.Exec(ctx, `UPDATE client_orders SET rep_user_id=$2, updated_at=$3 WHERE id=$1`, id, repUserID, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("order not found")
	}
	return nil
}

type DeliveredItemQty struct {
	ProductID    uuid.UUID
	QtyDelivered float64
}

type MarkDeliveredParams struct {
	OrderID              uuid.UUID
	Items                []DeliveredItemQty
	DeliveryNote         string
	AmountCollectedMinor int64
	ActorUserID          uuid.UUID
	History              domain.ClientOrderStatusHistory
	DebtCharge           *domain.DebtEntry
	DebtPayment          *domain.DebtEntry
	Now                  time.Time
}

func (s *Store) MarkDelivered(ctx context.Context, p MarkDeliveredParams) (*domain.ClientOrder, []domain.ClientOrderItem, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)

	var order domain.ClientOrder
	if err := tx.QueryRow(ctx, `SELECT `+clientOrderColumns+` FROM client_orders WHERE id=$1 FOR UPDATE`, p.OrderID).Scan(
		&order.ID, &order.UserID, &order.SupplierOrgID, &order.Status, &order.Currency, &order.TotalMinor,
		&order.DeliveryAddress, &order.DeliveryComment, &order.PaymentMethod, &order.RepUserID, &order.DeliveredAt,
		&order.DeliveryNote, &order.AmountCollectedMinor, &order.CreatedAt, &order.UpdatedAt, &order.PickupBranchID, &order.PaymentStatus, &order.IdempotencyKey); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, apperr.NotFound("order not found")
		}
		return nil, nil, err
	}

	rows, err := tx.Query(ctx, `
SELECT id, order_id, product_id, product_name, brand, qty, price_minor, qty_delivered
FROM client_order_items WHERE order_id=$1 FOR UPDATE`, p.OrderID)
	if err != nil {
		return nil, nil, err
	}
	items, err := scanClientOrderItemsRows(rows)
	if err != nil {
		return nil, nil, err
	}

	byProduct := make(map[uuid.UUID]float64, len(p.Items))
	for _, it := range p.Items {
		byProduct[it.ProductID] = it.QtyDelivered
	}
	var deliveredTotal int64
	for i := range items {
		qty, ok := byProduct[items[i].ProductID]
		if !ok {
			qty = items[i].Qty
		}
		if qty > items[i].Qty+1e-9 {
			return nil, nil, apperr.Validation("qty_delivered exceeds ordered quantity")
		}
		items[i].QtyDelivered = qty
		deliveredTotal += int64(qty*float64(items[i].PriceMinor) + 0.5)
		if _, err := tx.Exec(ctx, `UPDATE client_order_items SET qty_delivered=$2 WHERE id=$1`, items[i].ID, qty); err != nil {
			return nil, nil, err
		}
	}

	if _, err := tx.Exec(ctx, `
UPDATE client_orders SET status=$2, delivered_at=$3, delivery_note=$4, amount_collected_minor=$5, updated_at=$6
WHERE id=$1`,
		p.OrderID, domain.ClientOrderStatusDelivered, p.Now, p.DeliveryNote, p.AmountCollectedMinor, p.Now); err != nil {
		return nil, nil, err
	}
	order.Status = domain.ClientOrderStatusDelivered
	order.DeliveredAt = &p.Now
	order.DeliveryNote = p.DeliveryNote
	order.AmountCollectedMinor = p.AmountCollectedMinor
	order.UpdatedAt = p.Now

	if err := appendStatusHistoryTx(ctx, tx, p.History); err != nil {
		return nil, nil, err
	}

	charge := p.DebtCharge
	if charge == nil {
		charge = &domain.DebtEntry{
			ID: uuid.Must(uuid.NewV7()), SupplierOrgID: order.SupplierOrgID, ClientUserID: order.UserID,
			Kind: domain.DebtKindDeliveryCharge, AmountMinor: deliveredTotal,
			RefType: "client_order", RefID: &order.ID, ActorUserID: p.ActorUserID, CreatedAt: p.Now,
		}
	} else {
		charge.AmountMinor = deliveredTotal
	}
	if err := insertDebtEntryTx(ctx, tx, *charge); err != nil {
		return nil, nil, err
	}
	if p.DebtPayment != nil && p.DebtPayment.AmountMinor != 0 {
		if err := insertDebtEntryTx(ctx, tx, *p.DebtPayment); err != nil {
			return nil, nil, err
		}
	}

	locID, err := resolveSupplierLocationTx(ctx, tx, order.SupplierOrgID, p.Now)
	if err != nil {
		return nil, nil, err
	}
	orderRef := order.ID
	for _, it := range items {
		unreserve := domain.StockMovement{
			ID: uuid.Must(uuid.NewV7()), LocationID: locID, ProductID: it.ProductID,
			Kind: domain.MovementUnreserve, Qty: it.Qty, Reason: "client order delivered",
			ActorUserID: p.ActorUserID, RefType: "client_order", RefID: &orderRef, CreatedAt: p.Now,
		}
		if _, err := applyMovementTx(ctx, tx, unreserve); err != nil {
			return nil, nil, err
		}
		if it.QtyDelivered > 1e-9 {
			consumption := domain.StockMovement{
				ID: uuid.Must(uuid.NewV7()), LocationID: locID, ProductID: it.ProductID,
				Kind: domain.MovementConsumption, Qty: -it.QtyDelivered, Reason: "client order delivery",
				ActorUserID: p.ActorUserID, RefType: "client_order", RefID: &orderRef, CreatedAt: p.Now,
			}
			if _, err := applyMovementTx(ctx, tx, consumption); err != nil {
				return nil, nil, err
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	return &order, items, nil
}

func scanClientOrderItemsRows(rows pgx.Rows) ([]domain.ClientOrderItem, error) {
	defer rows.Close()
	var out []domain.ClientOrderItem
	for rows.Next() {
		var it domain.ClientOrderItem
		if err := rows.Scan(&it.ID, &it.OrderID, &it.ProductID, &it.ProductName, &it.Brand, &it.Qty, &it.PriceMinor, &it.QtyDelivered); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// --- debt ledger ---

func (s *Store) InsertDebtEntry(ctx context.Context, e domain.DebtEntry) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO debt_ledger(id, supplier_org_id, client_user_id, kind, amount_minor, ref_type, ref_id, note, actor_user_id, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		e.ID, e.SupplierOrgID, e.ClientUserID, e.Kind, e.AmountMinor, e.RefType, e.RefID, e.Note, e.ActorUserID, e.CreatedAt)
	return err
}

func insertDebtEntryTx(ctx context.Context, tx pgx.Tx, e domain.DebtEntry) error {
	_, err := tx.Exec(ctx, `
INSERT INTO debt_ledger(id, supplier_org_id, client_user_id, kind, amount_minor, ref_type, ref_id, note, actor_user_id, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		e.ID, e.SupplierOrgID, e.ClientUserID, e.Kind, e.AmountMinor, e.RefType, e.RefID, e.Note, e.ActorUserID, e.CreatedAt)
	return err
}

func (s *Store) SumDebt(ctx context.Context, supplierOrgID, clientUserID uuid.UUID) (int64, error) {
	var total int64
	err := s.pool.QueryRow(ctx, `
SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM debt_ledger
WHERE supplier_org_id=$1 AND client_user_id=$2`, supplierOrgID, clientUserID).Scan(&total)
	return total, err
}

// --- rep deliveries ---

func (s *Store) ListRepDeliveries(ctx context.Context, supplierOrgID uuid.UUID, repUserID *uuid.UUID, statuses []string) ([]domain.ClientOrder, error) {
	q := `SELECT ` + clientOrderColumns + ` FROM client_orders WHERE supplier_org_id=$1`
	args := []any{supplierOrgID}
	argN := 2
	if repUserID != nil {
		q += ` AND rep_user_id=$` + strconv.Itoa(argN)
		args = append(args, *repUserID)
		argN++
	}
	if len(statuses) > 0 {
		q += ` AND status = ANY($` + strconv.Itoa(argN) + `)`
		args = append(args, statuses)
	}
	q += ` ORDER BY created_at DESC`
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	return scanClientOrders(rows)
}

// --- import jobs ---

func (s *Store) GetImportJobByChecksum(ctx context.Context, orgID uuid.UUID, kind, checksum string) (*domain.ImportJob, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, organization_id, kind, checksum, status, report, created_by, created_at
FROM import_jobs WHERE organization_id=$1 AND kind=$2 AND checksum=$3`, orgID, kind, checksum)
	var j domain.ImportJob
	if err := row.Scan(&j.ID, &j.OrganizationID, &j.Kind, &j.Checksum, &j.Status, &j.Report, &j.CreatedBy, &j.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &j, nil
}

func (s *Store) GetImportJob(ctx context.Context, id uuid.UUID) (*domain.ImportJob, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, organization_id, kind, checksum, status, report, created_by, created_at
FROM import_jobs WHERE id=$1`, id)
	var j domain.ImportJob
	if err := row.Scan(&j.ID, &j.OrganizationID, &j.Kind, &j.Checksum, &j.Status, &j.Report, &j.CreatedBy, &j.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &j, nil
}

func (s *Store) InsertImportJob(ctx context.Context, j domain.ImportJob) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO import_jobs(id, organization_id, kind, checksum, status, report, created_by, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		j.ID, j.OrganizationID, j.Kind, j.Checksum, j.Status, j.Report, j.CreatedBy, j.CreatedAt)
	return err
}

func (s *Store) UpdateImportJob(ctx context.Context, id uuid.UUID, status string, report json.RawMessage) error {
	tag, err := s.pool.Exec(ctx, `UPDATE import_jobs SET status=$2, report=$3 WHERE id=$1`, id, status, report)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("import job not found")
	}
	return nil
}

func (s *Store) GetProductByOrgSKU(ctx context.Context, orgID uuid.UUID, sku string) (*domain.Product, error) {
	return scanProduct(s.pool.QueryRow(ctx, `SELECT `+productColumns+` FROM products WHERE organization_id=$1 AND sku=$2`, orgID, sku))
}

func listClientOrderItemsTx(ctx context.Context, tx pgx.Tx, orderID uuid.UUID) ([]domain.ClientOrderItem, error) {
	rows, err := tx.Query(ctx, `
SELECT id, order_id, product_id, product_name, brand, qty, price_minor, qty_delivered
FROM client_order_items WHERE order_id=$1 ORDER BY id`, orderID)
	if err != nil {
		return nil, err
	}
	return scanClientOrderItemsRows(rows)
}

// TransitionClientOrderTx updates status and optionally rep in one transaction with history.
type TransitionClientOrderParams struct {
	OrderID     uuid.UUID
	ToStatus    string
	RepUserID   *uuid.UUID
	ActorUserID uuid.UUID
	History     domain.ClientOrderStatusHistory
	Now         time.Time
}

func (s *Store) TransitionClientOrder(ctx context.Context, p TransitionClientOrderParams) (*domain.ClientOrder, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var order domain.ClientOrder
	if err := tx.QueryRow(ctx, `SELECT `+clientOrderColumns+` FROM client_orders WHERE id=$1 FOR UPDATE`, p.OrderID).Scan(
		&order.ID, &order.UserID, &order.SupplierOrgID, &order.Status, &order.Currency, &order.TotalMinor,
		&order.DeliveryAddress, &order.DeliveryComment, &order.PaymentMethod, &order.RepUserID, &order.DeliveredAt,
		&order.DeliveryNote, &order.AmountCollectedMinor, &order.CreatedAt, &order.UpdatedAt, &order.PickupBranchID, &order.PaymentStatus, &order.IdempotencyKey); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperr.NotFound("order not found")
		}
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
UPDATE client_orders SET status=$2, rep_user_id=COALESCE($3, rep_user_id), updated_at=$4 WHERE id=$1`,
		p.OrderID, p.ToStatus, p.RepUserID, p.Now); err != nil {
		return nil, err
	}
	order.Status = p.ToStatus
	if p.RepUserID != nil {
		order.RepUserID = p.RepUserID
	}
	order.UpdatedAt = p.Now

	if err := appendStatusHistoryTx(ctx, tx, p.History); err != nil {
		return nil, err
	}

	if p.ToStatus == domain.ClientOrderStatusCancelled {
		items, err := listClientOrderItemsTx(ctx, tx, p.OrderID)
		if err != nil {
			return nil, err
		}
		locID, err := resolveSupplierLocationTx(ctx, tx, order.SupplierOrgID, p.Now)
		if err != nil {
			return nil, err
		}
		orderRef := order.ID
		for _, it := range items {
			mv := domain.StockMovement{
				ID: uuid.Must(uuid.NewV7()), LocationID: locID, ProductID: it.ProductID,
				Kind: domain.MovementUnreserve, Qty: it.Qty, Reason: "client order cancelled",
				ActorUserID: p.ActorUserID, RefType: "client_order", RefID: &orderRef, CreatedAt: p.Now,
			}
			if _, err := applyMovementTx(ctx, tx, mv); err != nil {
				return nil, err
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &order, nil
}
