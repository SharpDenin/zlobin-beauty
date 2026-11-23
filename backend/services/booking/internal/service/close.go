package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

const branchCloseCancelReason = "филиал закрыт"

type BranchCloseStats struct {
	FutureAppointments int `json:"future_appointments"`
	MastersAffected    int `json:"masters_affected"`
	MastersPrivatePath int `json:"masters_private_path"`
	MastersUnlinkOnly  int `json:"masters_unlink_only"`
	ActiveLeases       int `json:"active_leases"`
	RequestedLeases    int `json:"requested_leases"`
}

type BranchCloseInput struct {
	OrganizationID uuid.UUID
	JobID          uuid.UUID
	ContactPhone   string
	ContactSource  string
	BranchName     string
	Reason         string
}

type BranchCloseResult struct {
	CancelledCount         int         `json:"cancelled_count"`
	PrivateMasterUserIDs   []uuid.UUID `json:"private_master_user_ids"`
	UnlinkMasterUserIDs    []uuid.UUID `json:"unlink_master_user_ids"`
	ChairsDeactivated      int         `json:"chairs_deactivated"`
	IntervalsCleared       int         `json:"intervals_cleared"`
	OccurrencesCancelled   int         `json:"occurrences_cancelled"`
}

func (s *Service) BranchCloseStats(ctx context.Context, branchID, orgID uuid.UUID) (*BranchCloseStats, error) {
	now := s.now().UTC()
	future, err := s.store.CountFutureCancellableByBranch(ctx, branchID, now)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	activeLeases, err := s.store.CountBranchLeasesByStatus(ctx, branchID, domain.LeaseActive)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	requestedLeases, err := s.store.CountBranchLeasesByStatus(ctx, branchID, domain.LeaseRequested)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	priv, unlink, err := s.classifyBranchMasters(ctx, branchID, orgID, now)
	if err != nil {
		return nil, err
	}
	return &BranchCloseStats{
		FutureAppointments: future,
		MastersAffected:    len(priv) + len(unlink),
		MastersPrivatePath: len(priv),
		MastersUnlinkOnly:  len(unlink),
		ActiveLeases:       activeLeases,
		RequestedLeases:    requestedLeases,
	}, nil
}

func (s *Service) CloseBranch(ctx context.Context, branchID uuid.UUID, in BranchCloseInput) (*BranchCloseResult, error) {
	_ = s.ensureBranchBookable(ctx, branchID) // frozen by organizations; continue regardless
	reason := strings.TrimSpace(in.Reason)
	if reason == "" {
		reason = branchCloseCancelReason
	}
	now := s.now().UTC()
	items, err := s.store.ListFutureCancellableByBranch(ctx, branchID, now)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	cancelled := 0
	actor := in.OrganizationID // system actor placeholder; history uses org id when no human actor
	if actor == uuid.Nil {
		actor = ids.New()
	}
	for _, a := range items {
		from := a.Status
		if err := s.store.TransitionStatus(ctx, a.ID, from, domain.StatusCancelledBySalon, actor, reason, now); err != nil {
			if ae, ok := apperr.As(err); ok && ae.Code == apperr.CodeAppointmentConcurrent {
				continue
			}
			return nil, apperr.Internal(err)
		}
		cancelled++
	}

	// Ensure notifications for every branch-close cancellation (fresh + resume).
	// Appointment cancel and notification creation are separate states.
	toNotify, err := s.store.ListBranchCloseCancelledForNotify(ctx, branchID, reason)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	clientBody := s.branchCloseNotifyBody(in.ContactPhone, in.BranchName)
	for _, a := range toNotify {
		// Appointment-scoped keys: stable across resume even when a new job id is allocated.
		clientKey := fmt.Sprintf("branch-close:%s:client", a.ID.String())
		masterKey := fmt.Sprintf("branch-close:%s:master", a.ID.String())
		if err := s.notifyIdempotent(ctx, a.ClientUserID, "appointment.cancelled_by_salon", "Запись отменена", clientBody, a.ID, clientKey); err != nil {
			return nil, apperr.Internal(fmt.Errorf("client notify: %w", err))
		}
		masterBody := a.ServiceName + " — " + reason
		if err := s.notifyIdempotent(ctx, a.MasterUserID, "appointment.cancelled_by_salon", "Запись отменена", masterBody, a.ID, masterKey); err != nil {
			return nil, apperr.Internal(fmt.Errorf("master notify: %w", err))
		}
	}

	intervalsCleared, err := s.store.DeleteWorkIntervalsByBranch(ctx, branchID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	chairsDeactivated, err := s.store.DeactivateChairsByBranch(ctx, branchID, now)
	if err != nil {
		return nil, apperr.Internal(err)
	}

	priv, unlink, err := s.classifyBranchMasters(ctx, branchID, in.OrganizationID, now)
	if err != nil {
		return nil, err
	}
	occCancelled, err := s.cancelMarketplaceOccurrences(ctx, branchID)
	if err != nil {
		return nil, err
	}

	return &BranchCloseResult{
		CancelledCount:       cancelled,
		PrivateMasterUserIDs: priv,
		UnlinkMasterUserIDs:  unlink,
		ChairsDeactivated:    chairsDeactivated,
		IntervalsCleared:     intervalsCleared,
		OccurrencesCancelled: occCancelled,
	}, nil
}

func (s *Service) branchCloseNotifyBody(phone, branchName string) string {
	name := strings.TrimSpace(branchName)
	if name == "" {
		name = "филиал"
	}
	phone = strings.TrimSpace(phone)
	if phone != "" {
		return fmt.Sprintf("Филиал «%s» закрывается, ваша запись отменена. Контактный телефон: %s", name, phone)
	}
	return fmt.Sprintf("Филиал «%s» закрывается, ваша запись отменена. Свяжитесь с салоном через приложение", name)
}

func (s *Service) ensureBranchBookable(ctx context.Context, branchID uuid.UUID) bool {
	if branchID == uuid.Nil || s.organizationsURL == "" || s.internalToken == "" {
		return true
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		s.organizationsURL+"/v1/internal/branches/"+branchID.String()+"/publication", nil)
	if err != nil {
		return true
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return true
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return true
	}
	var payload struct {
		BranchActive *bool `json:"branch_active"`
		BranchPublished bool `json:"branch_published"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&payload); err != nil {
		return true
	}
	if payload.BranchActive != nil {
		return *payload.BranchActive
	}
	return true
}

func (s *Service) requireBranchBookable(ctx context.Context, branchID uuid.UUID) error {
	if branchID == uuid.Nil {
		return nil
	}
	if !s.ensureBranchBookable(ctx, branchID) {
		return apperr.Conflict("branch is closed and cannot accept new appointments")
	}
	return nil
}

func (s *Service) classifyBranchMasters(ctx context.Context, branchID, orgID uuid.UUID, now time.Time) (privatePath, unlinkOnly []uuid.UUID, err error) {
	masters, err := s.listMastersBoundToBranch(ctx, branchID)
	if err != nil {
		return nil, nil, err
	}
	for _, userID := range masters {
		otherIntervals, err := s.store.HasWorkIntervalsInOtherBranches(ctx, userID, orgID, branchID)
		if err != nil {
			return nil, nil, apperr.Internal(err)
		}
		otherFuture, err := s.store.HasFutureAppointmentsInOtherBranches(ctx, userID, orgID, branchID, now)
		if err != nil {
			return nil, nil, apperr.Internal(err)
		}
		if otherIntervals || otherFuture {
			unlinkOnly = append(unlinkOnly, userID)
		} else {
			privatePath = append(privatePath, userID)
		}
	}
	return privatePath, unlinkOnly, nil
}

func (s *Service) listMastersBoundToBranch(ctx context.Context, branchID uuid.UUID) ([]uuid.UUID, error) {
	if s.marketplaceURL == "" || s.internalToken == "" {
		// Fallback: masters with intervals at this branch.
		ids, err := s.store.ListMasterUserIDsByBranchIntervals(ctx, branchID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		return ids, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		s.marketplaceURL+"/v1/internal/branches/"+branchID.String()+"/masters", nil)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return nil, apperr.Internal(fmt.Errorf("marketplace masters-by-branch status %d: %s", resp.StatusCode, string(body)))
	}
	var raw struct {
		Items []struct {
			UserID string `json:"user_id"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, apperr.Internal(err)
	}
	out := make([]uuid.UUID, 0, len(raw.Items))
	seen := map[uuid.UUID]struct{}{}
	for _, it := range raw.Items {
		id, err := uuid.Parse(it.UserID)
		if err != nil {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out, nil
}

func (s *Service) cancelMarketplaceOccurrences(ctx context.Context, branchID uuid.UUID) (int, error) {
	if s.marketplaceURL == "" || s.internalToken == "" {
		return 0, nil
	}
	payload, _ := json.Marshal(map[string]any{"branch_id": branchID.String()})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		s.marketplaceURL+"/v1/internal/branches/"+branchID.String()+"/cancel-occurrences", bytes.NewReader(payload))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode >= 300 {
		return 0, fmt.Errorf("cancel-occurrences status %d: %s", resp.StatusCode, string(body))
	}
	var out struct {
		Cancelled int `json:"cancelled"`
	}
	_ = json.Unmarshal(body, &out)
	return out.Cancelled, nil
}
