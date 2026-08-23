package store

import (
	"context"
	"time"

	"github.com/google/uuid"
)

func (s *Store) SupplierAnalytics(ctx context.Context, orgID uuid.UUID, from, to time.Time) (map[string]any, error) {
	if to.IsZero() {
		to = time.Now().UTC()
	}
	if from.IsZero() || !from.Before(to) {
		from = to.AddDate(0, 0, -30)
	}
	now := time.Now().UTC()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	quarterMonth := ((int(now.Month())-1)/3)*3 + 1
	quarterStart := time.Date(now.Year(), time.Month(quarterMonth), 1, 0, 0, 0, 0, time.UTC)

	var revenueToday, revenueMonth, revenueQuarter, ordersToday, ordersMonth, aov, unpaid, revenuePeriod, ordersPeriod int64
	err := s.pool.QueryRow(ctx, `
SELECT
  COALESCE(SUM(total_minor) FILTER (WHERE payment_status='paid' AND created_at >= $2), 0),
  COALESCE(SUM(total_minor) FILTER (WHERE payment_status='paid' AND created_at >= $3), 0),
  COALESCE(SUM(total_minor) FILTER (WHERE payment_status='paid' AND created_at >= $4), 0),
  COUNT(*) FILTER (WHERE status NOT IN ('cancelled','draft') AND created_at >= $2),
  COUNT(*) FILTER (WHERE status NOT IN ('cancelled','draft') AND created_at >= $3),
  COALESCE(AVG(total_minor) FILTER (WHERE payment_status='paid' AND created_at >= $3), 0)::bigint,
  COUNT(*) FILTER (WHERE payment_status IN ('pending','awaiting_payment')),
  COALESCE(SUM(total_minor) FILTER (WHERE payment_status='paid' AND created_at >= $5 AND created_at < $6), 0),
  COUNT(*) FILTER (WHERE status NOT IN ('cancelled','draft') AND created_at >= $5 AND created_at < $6)
FROM supplier_orders WHERE supplier_org_id=$1`,
		orgID, dayStart, monthStart, quarterStart, from, to).Scan(
		&revenueToday, &revenueMonth, &revenueQuarter,
		&ordersToday, &ordersMonth, &aov, &unpaid,
		&revenuePeriod, &ordersPeriod,
	)
	if err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
SELECT i.product_id, MAX(i.product_name), SUM(i.qty_ordered)::float8, SUM(i.qty_ordered * i.price_minor)::bigint
FROM supplier_order_items i
JOIN supplier_orders o ON o.id = i.order_id
WHERE o.supplier_org_id=$1 AND o.status NOT IN ('cancelled','draft') AND o.created_at >= $2 AND o.created_at < $3
GROUP BY i.product_id
ORDER BY SUM(i.qty_ordered) DESC
LIMIT 8`, orgID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	popular := []map[string]any{}
	for rows.Next() {
		var pid uuid.UUID
		var name string
		var qty float64
		var sales int64
		if err := rows.Scan(&pid, &name, &qty, &sales); err != nil {
			return nil, err
		}
		popular = append(popular, map[string]any{"product_id": pid.String(), "name": name, "qty": qty, "revenue_minor": sales})
	}

	dynRows, err := s.pool.Query(ctx, `
SELECT date_trunc('day', created_at)::date, COUNT(*), COALESCE(SUM(total_minor) FILTER (WHERE payment_status='paid'),0)
FROM supplier_orders
WHERE supplier_org_id=$1 AND created_at >= $2 AND created_at < $3
GROUP BY 1 ORDER BY 1`, orgID, from, to)
	if err != nil {
		return nil, err
	}
	defer dynRows.Close()
	dynamics := []map[string]any{}
	for dynRows.Next() {
		var day time.Time
		var cnt, rev int64
		if err := dynRows.Scan(&day, &cnt, &rev); err != nil {
			return nil, err
		}
		dynamics = append(dynamics, map[string]any{"period": day.Format("2006-01-02"), "orders": cnt, "revenue_minor": rev})
	}

	salonRows, err := s.pool.Query(ctx, `
SELECT destination_branch_id::text, COUNT(*), COALESCE(SUM(total_minor) FILTER (WHERE payment_status='paid'),0)
FROM supplier_orders
WHERE supplier_org_id=$1 AND destination_branch_id IS NOT NULL AND created_at >= $2 AND created_at < $3
GROUP BY 1 ORDER BY 3 DESC LIMIT 8`, orgID, from, to)
	if err != nil {
		return nil, err
	}
	defer salonRows.Close()
	topSalons := []map[string]any{}
	for salonRows.Next() {
		var branch string
		var cnt, rev int64
		if err := salonRows.Scan(&branch, &cnt, &rev); err != nil {
			return nil, err
		}
		topSalons = append(topSalons, map[string]any{"branch_id": branch, "orders": cnt, "revenue_minor": rev})
	}

	var unpaidMinor, paidPeriodMinor int64
	if err := s.pool.QueryRow(ctx, `
SELECT
  COALESCE(SUM(total_minor) FILTER (WHERE payment_status IN ('pending','awaiting_payment','authorized','partially_paid')), 0),
  COALESCE(SUM(total_minor) FILTER (WHERE payment_status='paid' AND created_at >= $2 AND created_at < $3), 0)
FROM supplier_orders WHERE supplier_org_id=$1 AND status NOT IN ('cancelled','draft')`,
		orgID, from, to).Scan(&unpaidMinor, &paidPeriodMinor); err != nil {
		return nil, err
	}

	catRows, err := s.pool.Query(ctx, `
SELECT COALESCE(NULLIF(c.name, ''), 'Без категории'), SUM(i.qty_ordered * i.price_minor)::bigint
FROM supplier_order_items i
JOIN supplier_orders o ON o.id = i.order_id
LEFT JOIN products p ON p.id = i.product_id
LEFT JOIN product_categories c ON c.id = p.category_id
WHERE o.supplier_org_id=$1 AND o.status NOT IN ('cancelled','draft') AND o.created_at >= $2 AND o.created_at < $3
GROUP BY 1
ORDER BY 2 DESC
LIMIT 8`, orgID, from, to)
	if err != nil {
		return nil, err
	}
	defer catRows.Close()
	categories := []map[string]any{}
	for catRows.Next() {
		var name string
		var rev int64
		if err := catRows.Scan(&name, &rev); err != nil {
			return nil, err
		}
		categories = append(categories, map[string]any{"category": name, "revenue_minor": rev})
	}

	var deliveriesToday int64
	if err := s.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM order_deliveries
WHERE supplier_org_id=$1 AND COALESCE(planned_delivery_at, created_at) >= $2
  AND status NOT IN ('cancelled','failed')`, orgID, dayStart).Scan(&deliveriesToday); err != nil {
		return nil, err
	}

	repRows, err := s.pool.Query(ctx, `
SELECT COALESCE(rep_user_id::text, 'unassigned'), COUNT(*),
       COALESCE(SUM(amount_collected_minor),0),
       COALESCE(SUM(GREATEST(total_minor - COALESCE(amount_collected_minor,0), 0)),0),
       COUNT(*) FILTER (WHERE created_at >= $4),
       COUNT(*) FILTER (WHERE status NOT IN ('delivered','cancelled') AND created_at >= $4)
FROM client_orders
WHERE supplier_org_id=$1 AND created_at >= $2 AND created_at < $3
GROUP BY 1 ORDER BY 3 DESC LIMIT 8`, orgID, from, to, dayStart)
	if err != nil {
		return nil, err
	}
	defer repRows.Close()
	reps := []map[string]any{}
	for repRows.Next() {
		var uid string
		var cnt, collected, remaining, todayCnt, unfinished int64
		if err := repRows.Scan(&uid, &cnt, &collected, &remaining, &todayCnt, &unfinished); err != nil {
			return nil, err
		}
		reps = append(reps, map[string]any{
			"user_id": uid, "orders": cnt, "collected_minor": collected, "remaining_minor": remaining,
			"deliveries_today": todayCnt, "unfinished_deliveries": unfinished,
		})
	}

	var deliveries int64
	if err := s.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM client_orders
WHERE supplier_org_id=$1 AND created_at >= $2 AND created_at < $3 AND status NOT IN ('cancelled','draft')`,
		orgID, from, to).Scan(&deliveries); err != nil {
		return nil, err
	}

	return map[string]any{
		"from": from, "to": to,
		"revenue_today_minor": revenueToday,
		"revenue_month_minor": revenueMonth,
		"revenue_quarter_minor": revenueQuarter,
		"revenue_minor": revenuePeriod,
		"orders_today": ordersToday,
		"orders_month": ordersMonth,
		"orders_count": ordersPeriod,
		"average_order_value_minor": aov,
		"unpaid_orders": unpaid,
		"unpaid_minor": unpaidMinor,
		"paid_minor": paidPeriodMinor,
		"outstanding_payments": unpaid,
		"outstanding": map[string]any{"paid_minor": paidPeriodMinor, "expected_minor": unpaidMinor},
		"deliveries_count": deliveries,
		"deliveries_today": deliveriesToday,
		"popular_products": popular,
		"sales_by_category": categories,
		"sales_dynamics": dynamics,
		"orders_dynamics": dynamics,
		"top_salons": topSalons,
		"representatives": reps,
	}, nil
}

func (s *Store) RepAnalytics(ctx context.Context, orgID, repUserID uuid.UUID, from, to time.Time) (map[string]any, error) {
	if to.IsZero() {
		to = time.Now().UTC()
	}
	if from.IsZero() || !from.Before(to) {
		from = to.AddDate(0, 0, -30)
	}
	now := time.Now().UTC()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)

	var todayCount, todayDone, todayCollect, todayExpected, monthCollect, monthExpected, monthOrders int64
	err := s.pool.QueryRow(ctx, `
SELECT
  COUNT(*) FILTER (WHERE created_at >= $3),
  COUNT(*) FILTER (WHERE status='delivered' AND COALESCE(delivered_at, created_at) >= $3),
  COALESCE(SUM(amount_collected_minor) FILTER (WHERE COALESCE(delivered_at, created_at) >= $3), 0),
  COALESCE(SUM(GREATEST(total_minor - COALESCE(amount_collected_minor,0), 0)) FILTER (WHERE created_at >= $3 AND status NOT IN ('cancelled','draft')), 0),
  COALESCE(SUM(amount_collected_minor) FILTER (WHERE COALESCE(delivered_at, created_at) >= $4), 0),
  COALESCE(SUM(GREATEST(total_minor - COALESCE(amount_collected_minor,0), 0)) FILTER (WHERE created_at >= $4 AND status NOT IN ('cancelled','draft')), 0),
  COUNT(*) FILTER (WHERE created_at >= $4)
FROM client_orders
WHERE supplier_org_id=$1 AND rep_user_id=$2`, orgID, repUserID, dayStart, monthStart).Scan(
		&todayCount, &todayDone, &todayCollect, &todayExpected, &monthCollect, &monthExpected, &monthOrders)
	if err != nil {
		return nil, err
	}

	dynRows, err := s.pool.Query(ctx, `
SELECT date_trunc('day', created_at)::date, COUNT(*),
       COALESCE(SUM(amount_collected_minor),0),
       COALESCE(SUM(total_minor),0)
FROM client_orders
WHERE supplier_org_id=$1 AND rep_user_id=$2 AND created_at >= $3 AND created_at < $4
GROUP BY 1 ORDER BY 1`, orgID, repUserID, from, to)
	if err != nil {
		return nil, err
	}
	defer dynRows.Close()
	dynamics := []map[string]any{}
	for dynRows.Next() {
		var day time.Time
		var cnt, collected, sales int64
		if err := dynRows.Scan(&day, &cnt, &collected, &sales); err != nil {
			return nil, err
		}
		dynamics = append(dynamics, map[string]any{
			"period": day.Format("2006-01-02"), "orders": cnt, "collected_minor": collected, "revenue_minor": sales,
		})
	}

	prodRows, err := s.pool.Query(ctx, `
SELECT i.product_id, MAX(i.product_name), SUM(i.qty)::float8, SUM(i.qty * i.price_minor)::bigint
FROM client_order_items i
JOIN client_orders o ON o.id = i.order_id
WHERE o.supplier_org_id=$1 AND o.rep_user_id=$2 AND o.created_at >= $3 AND o.created_at < $4
GROUP BY i.product_id
ORDER BY SUM(i.qty) DESC
LIMIT 8`, orgID, repUserID, from, to)
	if err != nil {
		return nil, err
	}
	defer prodRows.Close()
	popular := []map[string]any{}
	for prodRows.Next() {
		var pid uuid.UUID
		var name string
		var qty float64
		var sales int64
		if err := prodRows.Scan(&pid, &name, &qty, &sales); err != nil {
			return nil, err
		}
		popular = append(popular, map[string]any{"product_id": pid.String(), "name": name, "qty": qty, "revenue_minor": sales})
	}

	remaining := todayCount - todayDone
	if remaining < 0 {
		remaining = 0
	}
	rate := 0.0
	if todayCount > 0 {
		rate = float64(todayDone) / float64(todayCount)
	}
	return map[string]any{
		"from": from, "to": to,
		"deliveries_today": todayCount,
		"completed_today": todayDone,
		"remaining_today": remaining,
		"completion_rate": rate,
		"collected_today_minor": todayCollect,
		"expected_today_minor": todayExpected,
		"collected_month_minor": monthCollect,
		"expected_month_minor": monthExpected,
		"orders_month": monthOrders,
		"average_order_minor": func() int64 {
			if monthOrders == 0 {
				return 0
			}
			return monthCollect / monthOrders
		}(),
		"sales_dynamics": dynamics,
		"popular_products": popular,
	}, nil
}

func (s *Store) BackdateSupplierOrder(ctx context.Context, id uuid.UUID, at time.Time) error {
	tag, err := s.pool.Exec(ctx, `UPDATE supplier_orders SET created_at=$2, updated_at=$2, paid_at=CASE WHEN payment_status='paid' THEN $2 ELSE paid_at END WHERE id=$1`, id, at)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return err
	}
	return nil
}

func (s *Store) BackdateClientOrder(ctx context.Context, id uuid.UUID, at time.Time) error {
	_, err := s.pool.Exec(ctx, `
UPDATE client_orders
SET created_at=$2, updated_at=$2, delivered_at=CASE WHEN status='delivered' THEN $2 ELSE delivered_at END
WHERE id=$1`, id, at)
	return err
}

func (s *Store) IncomingByProduct(ctx context.Context, orgID uuid.UUID) (map[uuid.UUID]float64, error) {
	rows, err := s.pool.Query(ctx, `
SELECT i.product_id, COALESCE(SUM(i.qty_ordered - COALESCE(i.qty_delivered,0)),0)::float8
FROM supplier_order_items i
JOIN supplier_orders o ON o.id = i.order_id
WHERE o.supplier_org_id=$1 AND o.status IN ('confirmed','processing','picking','ready_for_dispatch','in_transit')
GROUP BY i.product_id`, orgID)
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

