package store

import (
	"context"

	"github.com/google/uuid"
)

func (s *Store) SupplierAnalytics(ctx context.Context, orgID uuid.UUID) (map[string]any, error) {
	var revenue, orders, aov, unpaid int64
	err := s.pool.QueryRow(ctx, `
SELECT COALESCE(SUM(total_minor) FILTER (WHERE payment_status='paid'), 0),
       COUNT(*) FILTER (WHERE status NOT IN ('cancelled','draft')),
       COALESCE(AVG(total_minor) FILTER (WHERE payment_status='paid'), 0)::bigint,
       COUNT(*) FILTER (WHERE payment_status IN ('pending','awaiting_payment'))
FROM supplier_orders WHERE supplier_org_id=$1`, orgID).Scan(&revenue, &orders, &aov, &unpaid)
	if err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `
SELECT i.product_id, MAX(i.product_name), SUM(i.qty_ordered)::float8, SUM(i.qty_ordered * i.price_minor)::bigint
FROM supplier_order_items i
JOIN supplier_orders o ON o.id = i.order_id
WHERE o.supplier_org_id=$1 AND o.status NOT IN ('cancelled','draft')
GROUP BY i.product_id
ORDER BY SUM(i.qty_ordered) DESC
LIMIT 8`, orgID)
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
SELECT date_trunc('month', created_at)::date, COUNT(*), COALESCE(SUM(total_minor) FILTER (WHERE payment_status='paid'),0)
FROM supplier_orders WHERE supplier_org_id=$1 AND created_at >= now() - interval '1 year'
GROUP BY 1 ORDER BY 1`, orgID)
	if err != nil {
		return nil, err
	}
	defer dynRows.Close()
	dynamics := []map[string]any{}
	for dynRows.Next() {
		var month string
		var cnt, rev int64
		if err := dynRows.Scan(&month, &cnt, &rev); err != nil {
			return nil, err
		}
		dynamics = append(dynamics, map[string]any{"period": month, "orders": cnt, "revenue_minor": rev})
	}
	return map[string]any{
		"revenue_minor": revenue, "orders_count": orders, "average_order_value_minor": aov,
		"unpaid_orders": unpaid, "popular_products": popular, "sales_dynamics": dynamics,
	}, nil
}
