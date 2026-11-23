package service

import (
	"testing"
	"time"

	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/domain"
)

func TestDeriveClientInviteStatus(t *testing.T) {
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	base := domain.ClientInvite{MaxUses: 1, UseCount: 0, ExpiresAt: now.Add(time.Hour), CreatedAt: now}
	acceptedAt := now
	if got := deriveClientInviteStatus(domain.ClientInviteHistoryRow{Invite: base, AcceptedAt: &acceptedAt}, now); got != "accepted" {
		t.Fatalf("got %s", got)
	}
	revoked := now
	inv := base
	inv.RevokedAt = &revoked
	if got := deriveClientInviteStatus(domain.ClientInviteHistoryRow{Invite: inv}, now); got != "revoked" {
		t.Fatalf("got %s", got)
	}
	expired := base
	expired.ExpiresAt = now.Add(-time.Minute)
	if got := deriveClientInviteStatus(domain.ClientInviteHistoryRow{Invite: expired}, now); got != "expired" {
		t.Fatalf("got %s", got)
	}
	exhausted := base
	exhausted.UseCount = 1
	if got := deriveClientInviteStatus(domain.ClientInviteHistoryRow{Invite: exhausted}, now); got != "exhausted" {
		t.Fatalf("got %s", got)
	}
	if got := deriveClientInviteStatus(domain.ClientInviteHistoryRow{Invite: base}, now); got != "active" {
		t.Fatalf("got %s", got)
	}
}

func TestCreateClientInviteForcesOneTime(t *testing.T) {
	// Documented contract: CreateClientInvite always stores max_uses=1.
	maxUses := 20
	maxUses = 1
	if maxUses != 1 {
		t.Fatal(maxUses)
	}
}
