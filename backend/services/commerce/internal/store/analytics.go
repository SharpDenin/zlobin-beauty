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

	repRows, err := s.pool.Query(ctx, `
SELECT COALESCE(rep_user_id::text, 'unassigned'), COUNT(*),
       COALESCE(SUM(amount_collected_minor),0),
       COALESCE(SUM(total_minor) FILTER (WHERE status <> 'delivered'),0)
FROM client_orders
WHERE supplier_org_id=$1 AND created_at >= $2 AND created_at < $3
GROUP BY 1 ORDER BY 3 DESC LIMIT 8`, orgID, from, to)
	if err != nil {
		return nil, err
	}
	defer repRows.Close()
	reps := []map[string]any{}
	for repRows.Next() {
		var uid string
		var cnt, collected, remaining int64
		if err := repRows.Scan(&uid, &cnt, &collected, &remaining); err != nil {
			return nil, err
		}
		reps = append(reps, map[string]any{
			"user_id": uid, "orders": cnt, "collected_minor": collected, "remaining_minor": remaining,
		})
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
		"outstanding_payments": unpaid,
		"popular_products": popular,
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

	var todayCount, todayDone, todayCollect, monthCollect, monthExpected, monthOrders int64
	err := s.pool.QueryRow(ctx, `
SELECT
  COUNT(*) FILTER (WHERE created_at >= $3),
  COUNT(*) FILTER (WHERE status='delivered' AND COALESCE(delivered_at, created_at) >= $3),
  COALESCE(SUM(amount_collected_minor) FILTER (WHERE COALESCE(delivered_at, created_at) >= $3), 0),
  COALESCE(SUM(amount_collected_minor) FILTER (WHERE COALESCE(delivered_at, created_at) >= $4), 0),
  COALESCE(SUM(total_minor) FILTER (WHERE status <> 'delivered' AND status <> 'cancelled' AND created_at >= $4), 0),
  COUNT(*) FILTER (WHERE created_at >= $4)
FROM client_orders
WHERE supplier_org_id=$1 AND rep_user_id=$2`, orgID, repUserID, dayStart, monthStart).Scan(
		&todayCount, &todayDone, &todayCollect, &monthCollect, &monthExpected, &monthOrders)
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
	return map[string]any{
		"from": from, "to": to,
		"deliveries_today": todayCount,
		"completed_today": todayDone,
		"remaining_today": remaining,
		"collected_today_minor": todayCollect,
		"collected_month_minor": monthCollect,
		"expected_month_minor": monthExpected,
		"orders_month": monthOrders,
		"sales_dynamics": dynamics,
		"popular_products": popular,
	}, nil
}
