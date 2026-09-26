package service

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/adminaudit"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type AdminDisputeDetail struct {
	Dispute domain.CardDispute
	Card    *domain.ClientCard
	Events  []domain.DisputeEvent
}

func (s *Service) AdminListDisputes(ctx context.Context, status string, limit, offset int) ([]domain.CardDispute, int, error) {
	items, err := s.store.ListDisputesAdmin(ctx, status, limit, offset)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	total, err := s.store.CountDisputesAdmin(ctx, status)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	return items, total, nil
}

func (s *Service) AdminGetDispute(ctx context.Context, id uuid.UUID) (*AdminDisputeDetail, error) {
	d, err := s.store.GetDispute(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if d == nil {
		return nil, apperr.NotFound("dispute not found")
	}
	card, err := s.store.GetCard(ctx, d.ClientCardID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	events, err := s.store.ListDisputeEvents(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return &AdminDisputeDetail{Dispute: *d, Card: card, Events: events}, nil
}

func (s *Service) ResolveDisputeAsPlatform(ctx context.Context, disputeID, actor uuid.UUID, status, reason string) (*domain.CardDispute, error) {
	d, err := s.store.GetDispute(ctx, disputeID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if d == nil {
		return nil, apperr.NotFound("dispute not found")
	}
	if d.Status != domain.DisputeOpen {
		return nil, apperr.Conflict("dispute is not open")
	}
	status = strings.TrimSpace(status)
	if status != domain.DisputeResolved && status != domain.DisputeRejected {
		return nil, apperr.Validation("status must be resolved or rejected")
	}
	now := s.now().UTC()
	from := d.Status
	d.Status = status
	d.ResolvedAt = &now
	d.ResolvedBy = &actor
	if err := s.store.ResolveDispute(ctx, *d, domain.DisputeEvent{
		ID: ids.New(), ActorUserID: actor, Action: "status." + status, FromStatus: &from, ToStatus: status, CreatedAt: now,
	}); err != nil {
		return nil, apperr.Internal(err)
	}
	adminaudit.Record(ctx, s.identityURL, s.internalToken, actor, "dispute."+status, "client_card_dispute", &disputeID, map[string]any{
		"reason": strings.TrimSpace(reason), "before": from, "after": status,
	})
	return d, nil
}

func (s *Service) AdminDisputeStats(ctx context.Context) (open int, total int, err error) {
	open, total, err = s.store.DisputeStats(ctx)
	if err != nil {
		return 0, 0, apperr.Internal(err)
	}
	return open, total, nil
}
