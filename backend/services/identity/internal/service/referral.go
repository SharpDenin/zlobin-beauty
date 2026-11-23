package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

const referralBatchSize = 10
const referralMonths = 3

type ReferralProgress struct {
	QualifiedCount  int        `json:"qualified_count"`
	ProgressInBatch int        `json:"progress_in_batch"`
	BatchSize       int        `json:"batch_size"`
	RewardsCount    int        `json:"rewards_count"`
	LastRewardAt    *time.Time `json:"last_reward_at,omitempty"`
}

type UserCounters struct {
	Clients   int `json:"clients"`
	Masters   int `json:"masters"`
	Suppliers int `json:"suppliers"`
	Owners    int `json:"owners"`
}

func (s *Service) RegisterReferralLink(ctx context.Context, inviter, invitee, clientInviteID uuid.UUID) error {
	if inviter == uuid.Nil || invitee == uuid.Nil || clientInviteID == uuid.Nil {
		return apperr.Validation("inviter, invitee and client_invite_id are required")
	}
	if inviter == invitee {
		return apperr.Unprocessable(apperr.CodeContactSelf, "self-referral is not allowed")
	}
	inviteeUser, err := s.store.GetUserByID(ctx, invitee)
	if err != nil {
		return apperr.Internal(err)
	}
	if inviteeUser == nil || inviteeUser.Status == "deleted" {
		return apperr.NotFound("invitee not found")
	}
	now := s.now().UTC()
	_, err = s.store.InsertReferralLink(ctx, inviter, invitee, clientInviteID, now)
	if err != nil {
		return apperr.Internal(err)
	}
	// Idempotent: existing link for invitee is fine (lifetime unique).
	return s.TryQualifyInvitee(ctx, invitee)
}

func (s *Service) TryQualifyInvitee(ctx context.Context, invitee uuid.UUID) error {
	if invitee == uuid.Nil {
		return nil
	}
	link, err := s.store.GetReferralByInvitee(ctx, invitee)
	if err != nil {
		return apperr.Internal(err)
	}
	if link == nil {
		return nil
	}
	now := s.now().UTC()
	newly, err := s.store.MarkReferralQualified(ctx, invitee, now)
	if err != nil {
		return apperr.Internal(err)
	}
	if !newly && link.QualifiedAt == nil {
		// Still not eligible (email not verified / deleted).
		return nil
	}
	// Grant is idempotent via referral_rewards UNIQUE(inviter, batch).
	return s.grantReferralBatches(ctx, link.InviterUserID)
}

func (s *Service) grantReferralBatches(ctx context.Context, inviter uuid.UUID) error {
	qualified, err := s.store.CountQualifiedReferrals(ctx, inviter)
	if err != nil {
		return apperr.Internal(err)
	}
	maxBatch, err := s.store.MaxReferralBatch(ctx, inviter)
	if err != nil {
		return apperr.Internal(err)
	}
	now := s.now().UTC()
	targetBatches := qualified / referralBatchSize
	for batch := maxBatch + 1; batch <= targetBatches; batch++ {
		claimed, err := s.store.ClaimReferralReward(ctx, inviter, batch, batch*referralBatchSize, referralMonths, now)
		if err != nil {
			return apperr.Internal(err)
		}
		if !claimed {
			continue
		}
		if err := s.extendPremiumMonths(ctx, inviter, referralMonths, now); err != nil {
			return err
		}
		meta, _ := json.Marshal(map[string]any{
			"batch": batch, "months": referralMonths, "qualified": batch * referralBatchSize,
		})
		_ = s.store.AddAudit(ctx, ids.New(), inviter, "subscription.referral_reward", "subscription", &inviter, meta, now)
	}
	return nil
}

func (s *Service) extendPremiumMonths(ctx context.Context, userID uuid.UUID, months int, now time.Time) error {
	sub, err := s.store.GetSubscription(ctx, userID)
	if err != nil {
		return apperr.Internal(err)
	}
	plan, status := "free", "expired"
	var trialEnds, paidUntil *time.Time
	if sub != nil {
		plan, status = sub.Plan, sub.Status
		trialEnds, paidUntil = sub.TrialEndsAt, sub.PaidUntil
	}
	newPlan, newStatus, newTrial, newPaid, clearCancelled := computePremiumExtend(plan, status, trialEnds, paidUntil, now, months)
	if err := s.store.ApplySubscriptionExtend(ctx, userID, newPlan, newStatus, newTrial, newPaid, clearCancelled, now); err != nil {
		return apperr.Internal(err)
	}
	return nil
}

func (s *Service) ReferralProgress(ctx context.Context, inviter uuid.UUID) (ReferralProgress, error) {
	qualified, err := s.store.CountQualifiedReferrals(ctx, inviter)
	if err != nil {
		return ReferralProgress{}, apperr.Internal(err)
	}
	rewards, err := s.store.ListReferralRewards(ctx, inviter)
	if err != nil {
		return ReferralProgress{}, apperr.Internal(err)
	}
	out := ReferralProgress{
		QualifiedCount:  qualified,
		ProgressInBatch: qualified % referralBatchSize,
		BatchSize:       referralBatchSize,
		RewardsCount:    len(rewards),
	}
	if len(rewards) > 0 {
		at := rewards[len(rewards)-1].GrantedAt
		out.LastRewardAt = &at
	}
	return out, nil
}

func (s *Service) UserCounters(ctx context.Context) (UserCounters, error) {
	clients, err := s.store.CountUsersByRole(ctx, "client")
	if err != nil {
		return UserCounters{}, apperr.Internal(err)
	}
	masters, err := s.store.CountUsersByRole(ctx, "master")
	if err != nil {
		return UserCounters{}, apperr.Internal(err)
	}
	suppliers, err := s.store.CountUsersByRole(ctx, "supplier")
	if err != nil {
		return UserCounters{}, apperr.Internal(err)
	}
	owners, err := s.fetchOwnerUsersCount(ctx)
	if err != nil {
		return UserCounters{}, err
	}
	return UserCounters{
		Clients:   clients,
		Masters:   masters,
		Suppliers: suppliers,
		Owners:    owners,
	}, nil
}

func (s *Service) fetchOwnerUsersCount(ctx context.Context) (int, error) {
	if s.organizationsURL == "" || s.internalToken == "" {
		return 0, apperr.Internal(fmt.Errorf("organizations service not configured"))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.organizationsURL+"/v1/internal/stats/owner-users-count", nil)
	if err != nil {
		return 0, apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, apperr.Internal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<16))
	if res.StatusCode >= 300 {
		return 0, apperr.Internal(fmt.Errorf("owner-users-count: %s %s", res.Status, strings.TrimSpace(string(body))))
	}
	var parsed struct {
		Count int `json:"count"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return 0, apperr.Internal(err)
	}
	return parsed.Count, nil
}
