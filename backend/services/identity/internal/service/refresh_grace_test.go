package service

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
)

func TestWithinRefreshGrace(t *testing.T) {
	now := time.Now()
	recent := now.Add(-5 * time.Second)
	old := now.Add(-2 * time.Minute)
	next := uuid.New()

	if !withinRefreshGrace(&domain.Session{RotatedAt: &recent, ReplacedBy: &next}, now) {
		t.Fatal("a token rotated 5s ago must be honoured (parallel refresh race)")
	}
	if withinRefreshGrace(&domain.Session{RotatedAt: &old, ReplacedBy: &next}, now) {
		t.Fatal("a token rotated minutes ago is reuse: revoke the family")
	}
	if withinRefreshGrace(&domain.Session{RevokedAt: &recent}, now) {
		t.Fatal("a logout/manual revoke has no successor and must never be graceful")
	}
	if withinRefreshGrace(nil, now) {
		t.Fatal("nil session")
	}
}
