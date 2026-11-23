package service

import (
	"context"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

type BranchCloseInput struct {
	OrganizationID       uuid.UUID
	PrivateMasterUserIDs []uuid.UUID
	UnlinkMasterUserIDs  []uuid.UUID
}

type BranchCloseResult struct {
	PrivateUpdated       int `json:"private_updated"`
	UnlinkUpdated        int `json:"unlink_updated"`
	OccurrencesCancelled int `json:"occurrences_cancelled"`
}

func (s *Service) ListMastersByBranch(ctx context.Context, branchID uuid.UUID) ([]domain.MasterProfile, error) {
	items, err := s.store.ListMastersByBranch(ctx, branchID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.MasterProfile{}
	}
	return items, nil
}

func (s *Service) CloseBranch(ctx context.Context, branchID uuid.UUID, in BranchCloseInput) (*BranchCloseResult, error) {
	now := s.now().UTC()
	occ, err := s.store.CancelScheduledOccurrencesByBranch(ctx, branchID, now)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	priv := 0
	for _, userID := range in.PrivateMasterUserIDs {
		if err := s.store.ClearMasterBranchAddPrivatePractice(ctx, userID, branchID, now); err != nil {
			return nil, apperr.Internal(err)
		}
		priv++
	}
	unlink := 0
	for _, userID := range in.UnlinkMasterUserIDs {
		if err := s.store.ClearMasterBranch(ctx, userID, branchID, now); err != nil {
			return nil, apperr.Internal(err)
		}
		unlink++
	}
	return &BranchCloseResult{
		PrivateUpdated:       priv,
		UnlinkUpdated:        unlink,
		OccurrencesCancelled: occ,
	}, nil
}

func (s *Service) CancelOccurrencesByBranch(ctx context.Context, branchID uuid.UUID) (int, error) {
	n, err := s.store.CancelScheduledOccurrencesByBranch(ctx, branchID, s.now().UTC())
	if err != nil {
		return 0, apperr.Internal(err)
	}
	return n, nil
}
