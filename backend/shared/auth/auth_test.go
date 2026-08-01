package auth_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/auth"
)

func TestPasswordHashRoundTrip(t *testing.T) {
	hash, err := auth.HashPassword("secret-password")
	if err != nil {
		t.Fatal(err)
	}
	if !auth.VerifyPassword(hash, "secret-password") {
		t.Fatal("expected password to verify")
	}
	if auth.VerifyPassword(hash, "wrong") {
		t.Fatal("expected mismatch")
	}
}

func TestTokenPair(t *testing.T) {
	secret := "test-secret-key-32-characters!!"
	userID := uuid.Must(uuid.NewV7())
	pair, err := auth.IssuePair(secret, userID, []string{"client"}, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	claims, err := auth.ParseAccessToken(secret, pair.AccessToken)
	if err != nil {
		t.Fatal(err)
	}
	if claims.UserID != userID {
		t.Fatalf("user id mismatch")
	}
	if auth.HashToken(pair.RefreshToken) != pair.RefreshTokenHash {
		t.Fatal("refresh hash mismatch")
	}
}
