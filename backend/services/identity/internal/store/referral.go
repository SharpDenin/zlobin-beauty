package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type ReferralLink struct {
	ID             uuid.UUID
	InviterUserID  uuid.UUID
	InviteeUserID  uuid.UUID
	ClientInviteID uuid.UUID
	AcceptedAt     time.Time
	QualifiedAt    *time.Time
	CreatedAt      time.Time
}

type ReferralReward struct {
	ID                    uuid.UUID
	InviterUserID         uuid.UUID
	BatchNumber           int
	QualifiedCountAtGrant int
	MonthsGranted         int
	GrantedAt             time.Time
}

// InsertReferralLink inserts a new link. Returns (true, nil) if inserted, (false, nil) if invitee already linked.
func (s *Store) InsertReferralLink(ctx context.Context, inviter, invitee, clientInviteID uuid.UUID, acceptedAt time.Time) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
INSERT INTO referral_links(id, inviter_user_id, invitee_user_id, client_invite_id, accepted_at, created_at)
VALUES ($1,$2,$3,$4,$5,$5)
ON CONFLICT (invitee_user_id) DO NOTHING`,
		ids.New(), inviter, invitee, clientInviteID, acceptedAt)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (s *Store) GetReferralByInvitee(ctx context.Context, invitee uuid.UUID) (*ReferralLink, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, inviter_user_id, invitee_user_id, client_invite_id, accepted_at, qualified_at, created_at
FROM referral_links WHERE invitee_user_id=$1`, invitee)
	var l ReferralLink
	if err := row.Scan(&l.ID, &l.InviterUserID, &l.InviteeUserID, &l.ClientInviteID, &l.AcceptedAt, &l.QualifiedAt, &l.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &l, nil
}

// MarkReferralQualified sets qualified_at once when invitee is email_verified and not deleted.
func (s *Store) MarkReferralQualified(ctx context.Context, invitee uuid.UUID, at time.Time) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
UPDATE referral_links rl
SET qualified_at = $2
FROM users u
WHERE rl.invitee_user_id = $1
  AND rl.qualified_at IS NULL
  AND u.id = rl.invitee_user_id
  AND u.email_verified = TRUE
  AND u.status <> 'deleted'`, invitee, at)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (s *Store) CountQualifiedReferrals(ctx context.Context, inviter uuid.UUID) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM referral_links
WHERE inviter_user_id=$1 AND qualified_at IS NOT NULL`, inviter).Scan(&n)
	return n, err
}

func (s *Store) MaxReferralBatch(ctx context.Context, inviter uuid.UUID) (int, error) {
	var n *int
	err := s.pool.QueryRow(ctx, `
SELECT MAX(batch_number) FROM referral_rewards WHERE inviter_user_id=$1`, inviter).Scan(&n)
	if err != nil {
		return 0, err
	}
	if n == nil {
		return 0, nil
	}
	return *n, nil
}

// ClaimReferralReward inserts a reward batch row. Returns false if batch already claimed.
func (s *Store) ClaimReferralReward(ctx context.Context, inviter uuid.UUID, batch, qualifiedCount, months int, at time.Time) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
INSERT INTO referral_rewards(id, inviter_user_id, batch_number, qualified_count_at_grant, months_granted, granted_at)
VALUES ($1,$2,$3,$4,$5,$6)
ON CONFLICT (inviter_user_id, batch_number) DO NOTHING`,
		ids.New(), inviter, batch, qualifiedCount, months, at)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (s *Store) ListReferralRewards(ctx context.Context, inviter uuid.UUID) ([]ReferralReward, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, inviter_user_id, batch_number, qualified_count_at_grant, months_granted, granted_at
FROM referral_rewards WHERE inviter_user_id=$1 ORDER BY batch_number ASC`, inviter)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ReferralReward
	for rows.Next() {
		var r ReferralReward
		if err := rows.Scan(&r.ID, &r.InviterUserID, &r.BatchNumber, &r.QualifiedCountAtGrant, &r.MonthsGranted, &r.GrantedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) CountUsersByRole(ctx context.Context, role string) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(DISTINCT u.id)
FROM users u
JOIN user_roles r ON r.user_id = u.id AND r.role = $1
WHERE u.status <> 'deleted'`, role).Scan(&n)
	return n, err
}

// ApplySubscriptionExtend writes computed premium extend fields.
func (s *Store) ApplySubscriptionExtend(ctx context.Context, userID uuid.UUID, plan, status string, trialEnds, paidUntil *time.Time, clearCancelled bool, now time.Time) error {
	existing, err := s.GetSubscription(ctx, userID)
	if err != nil {
		return err
	}
	if existing == nil {
		sub := domain.Subscription{
			UserID: userID, Plan: plan, Status: status,
			TrialEndsAt: trialEnds, PaidUntil: paidUntil, StartedAt: &now,
			CreatedAt: now, UpdatedAt: now,
		}
		if status == "trial" && trialEnds != nil {
			sub.TrialStartedAt = &now
		}
		return s.UpsertSubscription(ctx, sub)
	}
	cancelled := existing.CancelledAt
	if clearCancelled {
		cancelled = nil
	}
	started := existing.StartedAt
	if started == nil {
		started = &now
	}
	trialStarted := existing.TrialStartedAt
	if status == "trial" && trialStarted == nil {
		trialStarted = &now
	}
	_, err = s.pool.Exec(ctx, `
UPDATE user_subscriptions SET
  plan=$2, status=$3,
  trial_started_at=$4, trial_ends_at=$5,
  started_at=$6, paid_until=$7, cancelled_at=$8,
  updated_at=$9
WHERE user_id=$1`,
		userID, plan, status, trialStarted, trialEnds, started, paidUntil, cancelled, now)
	return err
}
