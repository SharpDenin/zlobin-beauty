package auth_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/auth"
)

func TestDefaultTTLs(t *testing.T) {
	if auth.AccessTTL != 15*time.Minute {
		t.Fatalf("AccessTTL=%s want 15m", auth.AccessTTL)
	}
	if auth.RefreshTTL != 30*24*time.Hour {
		t.Fatalf("RefreshTTL=%s want 30d", auth.RefreshTTL)
	}
}

func TestConfigureTTLsIgnoresZeroAndAffectsOnlyNewPairs(t *testing.T) {
	t.Cleanup(func() {
		auth.ConfigureTTLs(15*time.Minute, 30*24*time.Hour)
	})

	secret := "test-secret-key-32-characters!!"
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	before, err := auth.IssuePair(secret, userID, []string{"client"}, now)
	if err != nil {
		t.Fatal(err)
	}
	storedRefreshExp := before.RefreshExpiresAt

	auth.ConfigureTTLs(0, 0) // no-op
	if auth.AccessTTL != 15*time.Minute || auth.RefreshTTL != 30*24*time.Hour {
		t.Fatal("zero ConfigureTTLs must keep defaults")
	}

	auth.ConfigureTTLs(5*time.Minute, 48*time.Hour)
	if auth.AccessTTL != 5*time.Minute || auth.RefreshTTL != 48*time.Hour {
		t.Fatal("ConfigureTTLs did not apply")
	}

	// Previously issued refresh expiry is independent of the new package TTL —
	// sessions store expires_at at issue time; changing config never mass-revokes.
	if !storedRefreshExp.Equal(before.RefreshExpiresAt) {
		t.Fatal("issued pair must keep its own refresh expiry")
	}
	if storedRefreshExp.Sub(now) < 29*24*time.Hour {
		t.Fatalf("old pair should still reflect 30d policy at issue: %s", storedRefreshExp.Sub(now))
	}

	after, err := auth.IssuePair(secret, userID, []string{"client"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if after.AccessExpiresAt.Sub(now) != 5*time.Minute {
		t.Fatalf("new access TTL=%s", after.AccessExpiresAt.Sub(now))
	}
	if after.RefreshExpiresAt.Sub(now) != 48*time.Hour {
		t.Fatalf("new refresh TTL=%s", after.RefreshExpiresAt.Sub(now))
	}
}

func TestRefreshTokenOpaqueAndHashed(t *testing.T) {
	raw, err := auth.NewRefreshToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) < 40 {
		t.Fatalf("opaque refresh too short: %d", len(raw))
	}
	if auth.HashToken(raw) == raw {
		t.Fatal("hash must differ from raw")
	}
	if len(auth.HashToken(raw)) != 64 {
		t.Fatal("SHA-256 hex expected")
	}
}

func TestAccessJWTIsHS256(t *testing.T) {
	t.Cleanup(func() {
		auth.ConfigureTTLs(15*time.Minute, 30*24*time.Hour)
	})
	auth.ConfigureTTLs(15*time.Minute, 30*24*time.Hour)

	secret := "test-secret-key-32-characters!!"
	userID := uuid.Must(uuid.NewV7())
	sid := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	tok, exp, err := auth.IssueAccessToken(secret, userID, sid, []string{"client"}, now)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := auth.ParseAccessToken(secret, tok)
	if err != nil {
		t.Fatal(err)
	}
	if claims.UserID != userID || claims.SessionID != sid {
		t.Fatal("claims mismatch")
	}
	if exp.Sub(now) != 15*time.Minute {
		t.Fatalf("access TTL=%s", exp.Sub(now))
	}
}
