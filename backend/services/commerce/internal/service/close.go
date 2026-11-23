package service

import (
	"context"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

type BranchCloseBlocker struct {
	Code  string `json:"code"`
	Label string `json:"label"`
	Count int    `json:"count"`
	Href  string `json:"href,omitempty"`
}

func (s *Service) BranchCloseBlockers(ctx context.Context, branchID uuid.UUID) ([]BranchCloseBlocker, error) {
	var out []BranchCloseBlocker
	deliveries, err := s.store.CountOpenDeliveriesByBranch(ctx, branchID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if deliveries > 0 {
		out = append(out, BranchCloseBlocker{
			Code: "open_supplier_deliveries", Label: "Незавершённые поставки в филиал", Count: deliveries, Href: "/orders",
		})
	}
	orders, err := s.store.CountOpenSupplierOrdersByBranch(ctx, branchID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if orders > 0 {
		out = append(out, BranchCloseBlocker{
			Code: "open_supplier_orders", Label: "Незавершённые заказы поставщику", Count: orders, Href: "/orders",
		})
	}
	pickups, err := s.store.CountOpenClientPickupsByBranch(ctx, branchID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if pickups > 0 {
		out = append(out, BranchCloseBlocker{
			Code: "open_client_pickups", Label: "Клиентские заказы с самовывозом", Count: pickups, Href: "/shop/orders",
		})
	}
	recurring, err := s.store.CountOpenRecurringByBranch(ctx, branchID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if recurring > 0 {
		out = append(out, BranchCloseBlocker{
			Code: "open_recurring_agreements", Label: "Активные регулярные поставки", Count: recurring, Href: "/orders",
		})
	}
	if out == nil {
		out = []BranchCloseBlocker{}
	}
	return out, nil
}
