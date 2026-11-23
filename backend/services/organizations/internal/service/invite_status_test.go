package service

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/domain"
)

func TestDeriveSalonInviteStatus(t *testing.T) {
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	base := domain.SalonInvite{
		ID: uuid.New(), MaxUses: 1, UseCount: 0, ExpiresAt: now.Add(time.Hour), CreatedAt: now,
	}

	acceptedAt := now
	if got := deriveSalonInviteStatus(domain.SalonInviteHistoryRow{Invite: base, AcceptedAt: &acceptedAt}, now); got != "accepted" {
		t.Fatalf("got %s", got)
	}
	revoked := now
	if got := deriveSalonInviteStatus(domain.SalonInviteHistoryRow{Invite: domain.SalonInvite{MaxUses: 1, UseCount: 0, ExpiresAt: now.Add(time.Hour), RevokedAt: &revoked}}, now); got != "revoked" {
		t.Fatalf("got %s", got)
	}
	expired := domain.SalonInvite{MaxUses: 1, UseCount: 0, ExpiresAt: now.Add(-time.Hour)}
	if got := deriveSalonInviteStatus(domain.SalonInviteHistoryRow{Invite: expired}, now); got != "expired" {
		t.Fatalf("got %s", got)
	}
	exhausted := domain.SalonInvite{MaxUses: 1, UseCount: 1, ExpiresAt: now.Add(time.Hour)}
	if got := deriveSalonInviteStatus(domain.SalonInviteHistoryRow{Invite: exhausted}, now); got != "exhausted" {
		t.Fatalf("got %s", got)
	}
	if got := deriveSalonInviteStatus(domain.SalonInviteHistoryRow{Invite: base}, now); got != "active" {
		t.Fatalf("got %s", got)
	}
}
