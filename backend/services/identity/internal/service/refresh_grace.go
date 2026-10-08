package service

import (
	"context"
	"time"

	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
)

// refreshReuseGrace is how long after a rotation the OLD refresh token is still honoured.
const refreshReuseGrace = 20 * time.Second

// graceSuccessor returns the active successor of a just-rotated session, or nil when the
// presented token must be treated as reused (revoked by logout, rotated long ago, successor gone).
func (s *Service) graceSuccessor(ctx context.Context, old *domain.Session, now time.Time) *domain.Session {
	if !withinRefreshGrace(old, now) {
		return nil
	}
	succ, err := s.store.GetSessionByID(ctx, *old.ReplacedBy)
	if err != nil || succ == nil || succ.RevokedAt != nil || !now.Before(succ.ExpiresAt) || succ.FamilyID != old.FamilyID {
		return nil
	}
	return succ
}

func withinRefreshGrace(old *domain.Session, now time.Time) bool {
	return old != nil && old.RotatedAt != nil && old.ReplacedBy != nil && now.Sub(*old.RotatedAt) <= refreshReuseGrace
}
