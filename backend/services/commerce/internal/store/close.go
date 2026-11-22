package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
)

func (s *Store) CountOpenDeliveriesByBranch(ctx context.Context, branchID uuid.UUID) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*)::int FROM order_deliveries
WHERE destination_branch_id=$1
  AND status = ANY($2)`,
		branchID,
		[]string{
			domain.DeliveryStatusPending,
			domain.DeliveryStatusScheduled,
			domain.DeliveryStatusPreparing,
			domain.DeliveryStatusInTransit,
			domain.DeliveryStatusArrived,
		},
	).Scan(&n)
	return n, err
}

func (s *Store) CountOpenSupplierOrdersByBranch(ctx context.Context, branchID uuid.UUID) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*)::int FROM supplier_orders
WHERE destination_branch_id=$1
  AND status = ANY($2)`,
		branchID,
		[]string{
			domain.OrderStatusDraft,
			domain.OrderStatusNew,
			domain.OrderStatusSubmitted,
			domain.OrderStatusConfirmed,
			domain.OrderStatusProcessing,
			domain.OrderStatusPicking,
			domain.OrderStatusReadyForDispatch,
			domain.OrderStatusInTransit,
		},
	).Scan(&n)
	return n, err
}

func (s *Store) CountOpenClientPickupsByBranch(ctx context.Context, branchID uuid.UUID) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*)::int FROM client_orders
WHERE pickup_branch_id=$1
  AND status = ANY($2)`,
		branchID,
		[]string{
			domain.ClientOrderStatusSubmitted,
			domain.ClientOrderStatusConfirmed,
			domain.ClientOrderStatusPicking,
			domain.ClientOrderStatusInDelivery,
			domain.ClientOrderStatusReadyForPickup,
			domain.ClientOrderStatusDelivered,
		},
	).Scan(&n)
	return n, err
}

func (s *Store) CountOpenRecurringByBranch(ctx context.Context, branchID uuid.UUID) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*)::int FROM recurring_agreements
WHERE pickup_branch_id=$1
  AND status = ANY($2)`,
		branchID,
		[]string{"pending", "active", "paused", "pending_reconfirm"},
	).Scan(&n)
	return n, err
}
