package service

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

var salonPickupTransitions = map[string]map[string]bool{
	domain.ClientOrderStatusDelivered:      {domain.ClientOrderStatusReadyForPickup: true},
	domain.ClientOrderStatusReadyForPickup: {domain.ClientOrderStatusReceived: true},
}

func (s *Service) ListSalonPickupOrders(ctx context.Context, actor, branchID uuid.UUID) ([]domain.ClientOrder, error) {
	if _, err := s.requireSalonPickupAccess(ctx, actor, branchID); err != nil {
		return nil, err
	}
	items, err := s.store.ListClientOrdersByPickupBranch(ctx, branchID, nil)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.ClientOrder{}
	}
	return items, nil
}

func (s *Service) AcceptSalonPickupOrder(ctx context.Context, actor, orderID uuid.UUID) (*domain.ClientOrder, error) {
	o, err := s.store.GetClientOrder(ctx, orderID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if o == nil {
		return nil, apperr.NotFound("order not found")
	}
	if o.PickupBranchID == nil {
		return nil, apperr.Validation("order has no pickup branch")
	}
	b, err := s.requireSalonPickupAccess(ctx, actor, *o.PickupBranchID)
	if err != nil {
		return nil, err
	}
	allowed, ok := salonPickupTransitions[o.Status]
	if !ok || !allowed[domain.ClientOrderStatusReadyForPickup] {
		return nil, apperr.Conflict("invalid status transition from " + o.Status + " to ready_for_pickup")
	}
	now := s.now().UTC()
	out, err := s.store.TransitionClientOrderPickup(ctx, store.PickupTransitionParams{
		OrderID: orderID, ToStatus: domain.ClientOrderStatusReadyForPickup,
		PaymentStatus: o.PaymentStatus, ActorUserID: actor,
		History: domain.ClientOrderStatusHistory{
			ID: ids.New(), OrderID: orderID, FromStatus: o.Status, ToStatus: domain.ClientOrderStatusReadyForPickup,
			ActorUserID: actor, CreatedAt: now,
		},
		Now: now,
	})
	if err != nil {
		return nil, apperr.Internal(err)
	}
	num := domain.FormatClientOrderNumber(o.ID, o.CreatedAt)
	s.notifyClientOrder(ctx, o.UserID, "client_order.ready_for_pickup", "Заказ готов к выдаче",
		"Ваш заказ "+num+" готов к выдаче в "+b.Name, o.ID)
	return out, nil
}

type HandoverPickupInput struct {
	PaymentReceived      bool
	AmountCollectedMinor int64
}

func (s *Service) HandoverSalonPickupOrder(ctx context.Context, actor, orderID uuid.UUID, in HandoverPickupInput) (*domain.ClientOrder, error) {
	o, err := s.store.GetClientOrder(ctx, orderID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if o == nil {
		return nil, apperr.NotFound("order not found")
	}
	if o.PickupBranchID == nil {
		return nil, apperr.Validation("order has no pickup branch")
	}
	if _, err := s.requireSalonPickupAccess(ctx, actor, *o.PickupBranchID); err != nil {
		return nil, err
	}
	allowed, ok := salonPickupTransitions[o.Status]
	if !ok || !allowed[domain.ClientOrderStatusReceived] {
		return nil, apperr.Conflict("invalid status transition from " + o.Status + " to received")
	}
	payStatus := o.PaymentStatus
	switch strings.TrimSpace(o.PaymentMethod) {
	case domain.PaymentMethodCard:
		if payStatus != domain.PaymentStatusAuthorized && payStatus != domain.PaymentStatusPaid {
			return nil, apperr.Validation("online card payment must be authorized before handover")
		}
		payStatus = domain.PaymentStatusPaid
	case domain.PaymentMethodCash:
		if in.PaymentReceived || in.AmountCollectedMinor > 0 {
			payStatus = domain.PaymentStatusPaid
		}
	case domain.PaymentMethodBankTransfer:
		if payStatus == domain.PaymentStatusAwaitingPayment && in.PaymentReceived {
			payStatus = domain.PaymentStatusPaid
		}
	}
	now := s.now().UTC()
	amount := o.AmountCollectedMinor
	if in.AmountCollectedMinor > 0 {
		amount = in.AmountCollectedMinor
	}
	out, err := s.store.TransitionClientOrderPickup(ctx, store.PickupTransitionParams{
		OrderID: orderID, ToStatus: domain.ClientOrderStatusReceived,
		PaymentStatus: payStatus, AmountCollectedMinor: amount, ActorUserID: actor,
		History: domain.ClientOrderStatusHistory{
			ID: ids.New(), OrderID: orderID, FromStatus: o.Status, ToStatus: domain.ClientOrderStatusReceived,
			ActorUserID: actor, CreatedAt: now,
		},
		Now: now,
	})
	if err != nil {
		return nil, apperr.Internal(err)
	}
	num := domain.FormatClientOrderNumber(o.ID, o.CreatedAt)
	s.notifyClientOrder(ctx, o.UserID, "client_order.received", "Заказ получен",
		"Заказ "+num+" успешно выдан", o.ID)
	return out, nil
}
