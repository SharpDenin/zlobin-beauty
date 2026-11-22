package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

// BranchClosePreflight gathers counts and blockers without mutating state.
func (s *Service) BranchClosePreflight(ctx context.Context, actor, branchID uuid.UUID) (*domain.BranchClosePreflight, error) {
	b, org, err := s.loadBranchForClose(ctx, actor, branchID)
	if err != nil {
		return nil, err
	}
	out := &domain.BranchClosePreflight{
		BranchID:         b.ID,
		BranchName:       b.Name,
		OrganizationID:   org.ID,
		OrganizationName: org.Name,
		Active:           b.Active,
		AlreadyClosed:    !b.Active,
		Blockers:         []domain.BranchCloseBlocker{},
	}
	latest, _ := s.store.LatestBranchCloseJob(ctx, branchID)
	if latest != nil {
		id := latest.ID
		out.LatestJobID = &id
		out.LatestJobStatus = latest.Status
		out.LatestJobError = latest.ErrorMessage
		if latest.Status == domain.BranchCloseCompleted {
			out.CompletedJobID = &id
			out.ContactPhone = latest.ContactPhone
			out.ContactSource = latest.ContactSource
			out.FutureAppointments = latest.FutureAppointments
			out.MastersAffected = latest.MastersAffected
			out.LastActiveBranch = latest.LastActiveBranch
			out.WillUnpublishOrg = latest.OrgUnpublished
			out.CanClose = false
			out.ContactDisplay = contactDisplay(latest.ContactPhone, latest.ContactSource)
			return out, nil
		}
		if latest.Status == domain.BranchCloseRunning {
			out.CanClose = false
			out.ContactPhone = latest.ContactPhone
			out.ContactSource = latest.ContactSource
			out.ContactDisplay = contactDisplay(latest.ContactPhone, latest.ContactSource)
			out.FutureAppointments = latest.FutureAppointments
			out.MastersAffected = latest.MastersAffected
			return out, nil
		}
	}

	activeCount, err := s.store.CountActiveBranches(ctx, org.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	out.LastActiveBranch = b.Active && activeCount <= 1
	out.WillUnpublishOrg = out.LastActiveBranch && org.Published

	phone, source := s.resolveCloseContact(ctx, org.ID, b)
	if latest != nil && (latest.ContactPhone != "" || latest.ContactSource != "") {
		phone, source = latest.ContactPhone, latest.ContactSource
	}
	out.ContactPhone = phone
	out.ContactSource = source
	out.ContactDisplay = contactDisplay(phone, source)

	booking, err := s.fetchBookingCloseStats(ctx, branchID, org.ID)
	if err != nil {
		return nil, err
	}
	out.FutureAppointments = booking.FutureAppointments
	out.MastersAffected = booking.MastersAffected
	out.MastersPrivatePath = booking.MastersPrivatePath
	out.MastersUnlinkOnly = booking.MastersUnlinkOnly

	blockers, err := s.fetchCommerceBlockers(ctx, branchID)
	if err != nil {
		return nil, err
	}
	out.Blockers = append(blockers, bookingLeaseBlockers(booking)...)
	canResumeFailed := !b.Active && latest != nil &&
		(latest.Status == domain.BranchCloseFailed || latest.Status == domain.BranchCloseBlocked)
	out.CanClose = len(out.Blockers) == 0 && (b.Active || canResumeFailed)
	return out, nil
}

// CloseBranch runs the synchronous close orchestration.
func (s *Service) CloseBranch(ctx context.Context, actor, branchID uuid.UUID) (*domain.BranchCloseJob, error) {
	b, org, err := s.loadBranchForClose(ctx, actor, branchID)
	if err != nil {
		return nil, err
	}
	if running, _ := s.store.RunningBranchCloseJob(ctx, branchID); running != nil {
		return running, nil
	}
	latest, _ := s.store.LatestBranchCloseJob(ctx, branchID)
	if latest != nil && latest.Status == domain.BranchCloseCompleted {
		return latest, nil
	}

	pre, err := s.BranchClosePreflight(ctx, actor, branchID)
	if err != nil {
		return nil, err
	}
	// Already inactive: resume failed orchestration or record idempotent completion.
	if !b.Active {
		job := domain.BranchCloseJob{
			ID: ids.New(), BranchID: b.ID, OrganizationID: org.ID, ActorUserID: actor,
			Status: domain.BranchCloseRunning, ContactPhone: pre.ContactPhone, ContactSource: pre.ContactSource,
			FutureAppointments: pre.FutureAppointments, MastersAffected: pre.MastersAffected,
			LastActiveBranch: pre.LastActiveBranch, BlockersJSON: json.RawMessage(`[]`),
			CreatedAt: s.now().UTC(), UpdatedAt: s.now().UTC(), ResultJSON: json.RawMessage(`{}`),
		}
		if latest != nil && (latest.ContactPhone != "" || latest.ContactSource != "") {
			job.ContactPhone = latest.ContactPhone
			job.ContactSource = latest.ContactSource
		}
		if err := s.store.InsertBranchCloseJob(ctx, job); err != nil {
			if running, _ := s.store.RunningBranchCloseJob(ctx, branchID); running != nil {
				return running, nil
			}
			return nil, apperr.Internal(err)
		}
		return s.finishBranchClose(ctx, &job, org, b, true)
	}

	now := s.now().UTC()
	blockersRaw, _ := json.Marshal(pre.Blockers)
	job := domain.BranchCloseJob{
		ID: ids.New(), BranchID: b.ID, OrganizationID: org.ID, ActorUserID: actor,
		Status: domain.BranchCloseRunning, ContactPhone: pre.ContactPhone, ContactSource: pre.ContactSource,
		FutureAppointments: pre.FutureAppointments, MastersAffected: pre.MastersAffected,
		LastActiveBranch: pre.LastActiveBranch, BlockersJSON: blockersRaw,
		CreatedAt: now, UpdatedAt: now, ResultJSON: json.RawMessage(`{}`),
	}
	if len(pre.Blockers) > 0 {
		job.Status = domain.BranchCloseBlocked
		job.ErrorMessage = "есть незавершённые операции, мешающие закрытию"
		job.CompletedAt = &now
		if err := s.store.InsertBranchCloseJob(ctx, job); err != nil {
			return nil, apperr.Internal(err)
		}
		return &job, apperr.Conflict("branch close blocked by unfinished operations").WithDetails(map[string]any{
			"job_id": job.ID.String(), "blockers": pre.Blockers,
		})
	}
	if err := s.store.InsertBranchCloseJob(ctx, job); err != nil {
		if running, _ := s.store.RunningBranchCloseJob(ctx, branchID); running != nil {
			return running, nil
		}
		return nil, apperr.Internal(err)
	}

	// Freeze immediately so new bookings cannot attach to this branch.
	if _, err := s.store.TryBeginBranchClose(ctx, branchID, now); err != nil {
		job.Status = domain.BranchCloseFailed
		job.ErrorMessage = "не удалось деактивировать филиал"
		job.UpdatedAt = s.now().UTC()
		job.CompletedAt = &job.UpdatedAt
		_ = s.store.UpdateBranchCloseJob(ctx, job)
		return &job, apperr.Internal(err)
	}
	return s.finishBranchClose(ctx, &job, org, b, pre.LastActiveBranch)
}

func (s *Service) finishBranchClose(ctx context.Context, job *domain.BranchCloseJob, org *domain.Organization, b *domain.Branch, lastActive bool) (*domain.BranchCloseJob, error) {
	cancelRes, err := s.postBookingClose(ctx, b.ID, org.ID, job.ID, job.ContactPhone, job.ContactSource, b.Name)
	if err != nil {
		job.Status = domain.BranchCloseFailed
		job.ErrorMessage = "ошибка отмены записей: " + err.Error()
		job.UpdatedAt = s.now().UTC()
		job.CompletedAt = &job.UpdatedAt
		_ = s.store.UpdateBranchCloseJob(ctx, *job)
		return job, apperr.Internal(err)
	}

	if err := s.postMarketplaceClose(ctx, b.ID, org.ID, cancelRes.PrivateMasterUserIDs, cancelRes.UnlinkMasterUserIDs); err != nil {
		job.Status = domain.BranchCloseFailed
		job.ErrorMessage = "ошибка обновления мастеров: " + err.Error()
		job.UpdatedAt = s.now().UTC()
		job.CompletedAt = &job.UpdatedAt
		_ = s.store.UpdateBranchCloseJob(ctx, *job)
		return job, apperr.Internal(err)
	}

	orgUnpublished := false
	if lastActive && org.Published {
		org.Published = false
		org.UpdatedAt = s.now().UTC()
		if err := s.store.UpdateOrg(ctx, *org); err != nil {
			job.Status = domain.BranchCloseFailed
			job.ErrorMessage = "не удалось снять салон с публикации"
			job.UpdatedAt = s.now().UTC()
			job.CompletedAt = &job.UpdatedAt
			_ = s.store.UpdateBranchCloseJob(ctx, *job)
			return job, apperr.Internal(err)
		}
		orgUnpublished = true
	}

	result, _ := json.Marshal(map[string]any{
		"cancelled_appointments": cancelRes.CancelledCount,
		"private_masters":        len(cancelRes.PrivateMasterUserIDs),
		"unlinked_masters":       len(cancelRes.UnlinkMasterUserIDs),
		"chairs_deactivated":     cancelRes.ChairsDeactivated,
		"intervals_cleared":      cancelRes.IntervalsCleared,
		"occurrences_cancelled":  cancelRes.OccurrencesCancelled,
	})
	done := s.now().UTC()
	job.Status = domain.BranchCloseCompleted
	job.OrgUnpublished = orgUnpublished
	job.ResultJSON = result
	job.UpdatedAt = done
	job.CompletedAt = &done
	if err := s.store.UpdateBranchCloseJob(ctx, *job); err != nil {
		return nil, apperr.Internal(err)
	}
	return job, nil
}

func (s *Service) GetBranchCloseJob(ctx context.Context, actor, jobID uuid.UUID) (*domain.BranchCloseJob, error) {
	job, err := s.store.GetBranchCloseJob(ctx, jobID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if job == nil {
		return nil, apperr.NotFound("close job not found")
	}
	if err := s.requireOwnerAdmin(ctx, job.OrganizationID, actor); err != nil {
		return nil, err
	}
	return job, nil
}

func (s *Service) loadBranchForClose(ctx context.Context, actor, branchID uuid.UUID) (*domain.Branch, *domain.Organization, error) {
	b, err := s.store.GetBranch(ctx, branchID)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if b == nil {
		return nil, nil, apperr.NotFound("branch not found")
	}
	if err := s.requireOwnerAdmin(ctx, b.OrganizationID, actor); err != nil {
		return nil, nil, err
	}
	org, err := s.store.GetOrg(ctx, b.OrganizationID)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if org == nil {
		return nil, nil, apperr.NotFound("organization not found")
	}
	return b, org, nil
}

func contactDisplay(phone, source string) string {
	phone = strings.TrimSpace(phone)
	if phone != "" {
		return phone
	}
	return "Свяжитесь с салоном через приложение"
}

func (s *Service) resolveCloseContact(ctx context.Context, orgID uuid.UUID, b *domain.Branch) (phone, source string) {
	members, err := s.store.ListMembershipsByOrg(ctx, orgID)
	if err != nil {
		if p := strings.TrimSpace(b.Phone); p != "" {
			return p, "branch"
		}
		return "", "none"
	}
	return s.selectCloseContact(ctx, members, b)
}

// selectCloseContact applies admin → owner → branch → none phone precedence.
func (s *Service) selectCloseContact(ctx context.Context, members []domain.Membership, b *domain.Branch) (phone, source string) {
	type cand struct {
		userID uuid.UUID
		at     time.Time
	}
	var admins, owners []cand
	for _, m := range members {
		if m.Status != "active" {
			continue
		}
		switch m.Role {
		case "admin":
			admins = append(admins, cand{m.UserID, m.CreatedAt})
		case "owner":
			owners = append(owners, cand{m.UserID, m.CreatedAt})
		}
	}
	sort.Slice(admins, func(i, j int) bool {
		if admins[i].at.Equal(admins[j].at) {
			return admins[i].userID.String() < admins[j].userID.String()
		}
		return admins[i].at.Before(admins[j].at)
	})
	sort.Slice(owners, func(i, j int) bool {
		if owners[i].at.Equal(owners[j].at) {
			return owners[i].userID.String() < owners[j].userID.String()
		}
		return owners[i].at.Before(owners[j].at)
	})
	for _, c := range admins {
		if p := s.identityPhone(ctx, c.userID); p != "" {
			return p, "admin"
		}
	}
	for _, c := range owners {
		if p := s.identityPhone(ctx, c.userID); p != "" {
			return p, "owner"
		}
	}
	if p := strings.TrimSpace(b.Phone); p != "" {
		return p, "branch"
	}
	return "", "none"
}

func (s *Service) identityPhone(ctx context.Context, userID uuid.UUID) string {
	if s.identityURL == "" || s.internalToken == "" {
		return ""
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.identityURL+"/v1/internal/users/"+userID.String(), nil)
	if err != nil {
		return ""
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return ""
	}
	var u struct {
		Phone string `json:"phone"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&u); err != nil {
		return ""
	}
	return strings.TrimSpace(u.Phone)
}

type bookingCloseStats struct {
	FutureAppointments int      `json:"future_appointments"`
	MastersAffected    int      `json:"masters_affected"`
	MastersPrivatePath int      `json:"masters_private_path"`
	MastersUnlinkOnly  int      `json:"masters_unlink_only"`
	ActiveLeases       int      `json:"active_leases"`
	RequestedLeases    int      `json:"requested_leases"`
}

type bookingCloseResult struct {
	CancelledCount         int         `json:"cancelled_count"`
	PrivateMasterUserIDs   []uuid.UUID `json:"private_master_user_ids"`
	UnlinkMasterUserIDs    []uuid.UUID `json:"unlink_master_user_ids"`
	ChairsDeactivated      int         `json:"chairs_deactivated"`
	IntervalsCleared       int         `json:"intervals_cleared"`
	OccurrencesCancelled   int         `json:"occurrences_cancelled"`
}

func (s *Service) fetchBookingCloseStats(ctx context.Context, branchID, orgID uuid.UUID) (*bookingCloseStats, error) {
	if s.bookingURL == "" || s.internalToken == "" {
		return &bookingCloseStats{}, nil
	}
	url := fmt.Sprintf("%s/v1/internal/branches/%s/close-stats?organization_id=%s", s.bookingURL, branchID, orgID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
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
		return nil, apperr.Internal(fmt.Errorf("booking close-stats status %d: %s", resp.StatusCode, string(body)))
	}
	var out bookingCloseStats
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, apperr.Internal(err)
	}
	return &out, nil
}

func bookingLeaseBlockers(stats *bookingCloseStats) []domain.BranchCloseBlocker {
	if stats == nil {
		return nil
	}
	var out []domain.BranchCloseBlocker
	if stats.ActiveLeases > 0 {
		out = append(out, domain.BranchCloseBlocker{
			Code: "active_chair_leases", Label: "Активные аренды кресел", Count: stats.ActiveLeases, Href: "/salon/settings",
		})
	}
	if stats.RequestedLeases > 0 {
		out = append(out, domain.BranchCloseBlocker{
			Code: "requested_chair_leases", Label: "Заявки на аренду кресел", Count: stats.RequestedLeases, Href: "/salon/settings",
		})
	}
	return out
}

func (s *Service) fetchCommerceBlockers(ctx context.Context, branchID uuid.UUID) ([]domain.BranchCloseBlocker, error) {
	if s.commerceURL == "" || s.internalToken == "" {
		return nil, nil
	}
	url := fmt.Sprintf("%s/v1/internal/branches/%s/close-blockers", s.commerceURL, branchID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
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
		return nil, apperr.Internal(fmt.Errorf("commerce close-blockers status %d: %s", resp.StatusCode, string(body)))
	}
	var raw struct {
		Blockers []domain.BranchCloseBlocker `json:"blockers"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, apperr.Internal(err)
	}
	if raw.Blockers == nil {
		raw.Blockers = []domain.BranchCloseBlocker{}
	}
	return raw.Blockers, nil
}

func (s *Service) postBookingClose(ctx context.Context, branchID, orgID, jobID uuid.UUID, contactPhone, contactSource, branchName string) (*bookingCloseResult, error) {
	if s.bookingURL == "" || s.internalToken == "" {
		return &bookingCloseResult{}, nil
	}
	payload, _ := json.Marshal(map[string]any{
		"organization_id": orgID.String(),
		"job_id":          jobID.String(),
		"contact_phone":   contactPhone,
		"contact_source":  contactSource,
		"branch_name":     branchName,
		"reason":          domain.BranchCloseCancelReason,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.bookingURL+"/v1/internal/branches/"+branchID.String()+"/close", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}
	var out struct {
		CancelledCount       int      `json:"cancelled_count"`
		PrivateMasterUserIDs []string `json:"private_master_user_ids"`
		UnlinkMasterUserIDs  []string `json:"unlink_master_user_ids"`
		ChairsDeactivated    int      `json:"chairs_deactivated"`
		IntervalsCleared     int      `json:"intervals_cleared"`
		OccurrencesCancelled int      `json:"occurrences_cancelled"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	res := &bookingCloseResult{
		CancelledCount: out.CancelledCount, ChairsDeactivated: out.ChairsDeactivated,
		IntervalsCleared: out.IntervalsCleared, OccurrencesCancelled: out.OccurrencesCancelled,
	}
	for _, id := range out.PrivateMasterUserIDs {
		if u, err := uuid.Parse(id); err == nil {
			res.PrivateMasterUserIDs = append(res.PrivateMasterUserIDs, u)
		}
	}
	for _, id := range out.UnlinkMasterUserIDs {
		if u, err := uuid.Parse(id); err == nil {
			res.UnlinkMasterUserIDs = append(res.UnlinkMasterUserIDs, u)
		}
	}
	return res, nil
}

func (s *Service) postMarketplaceClose(ctx context.Context, branchID, orgID uuid.UUID, privateIDs, unlinkIDs []uuid.UUID) error {
	if s.marketplaceURL == "" || s.internalToken == "" {
		return nil
	}
	priv := make([]string, 0, len(privateIDs))
	for _, id := range privateIDs {
		priv = append(priv, id.String())
	}
	unlink := make([]string, 0, len(unlinkIDs))
	for _, id := range unlinkIDs {
		unlink = append(unlink, id.String())
	}
	payload, _ := json.Marshal(map[string]any{
		"organization_id":          orgID.String(),
		"private_master_user_ids":  priv,
		"unlink_master_user_ids":   unlink,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.marketplaceURL+"/v1/internal/branches/"+branchID.String()+"/close", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
		return fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}
	return nil
}
