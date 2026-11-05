package service

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"

	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/db"
	"github.com/zlobin/zlobin-beauty/backend/shared/mailer"
)

// Live SMTP + AUTH flows. Enable with SMTP_LIVE=1 and real SMTP_* / DATABASE_URL.
// Does not print tokens or passwords.
func TestLiveSMTPAUTHFlows(t *testing.T) {
	if os.Getenv("SMTP_LIVE") != "1" {
		t.Skip("set SMTP_LIVE=1 for real SMTP AUTH e2e")
	}
	email := strings.TrimSpace(os.Getenv("SMTP_LIVE_EMAIL"))
	if email == "" {
		t.Fatal("SMTP_LIVE_EMAIL required")
	}
	passA := envOr("SMTP_LIVE_OLD_PASSWORD", "SalonXTest01!")
	passB := envOr("SMTP_LIVE_NEW_PASSWORD", "SalonXTest02!")
	dsn := os.Getenv("IDENTITY_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Fatal("DATABASE_URL required")
	}
	ml := mailer.NewFromEnv()
	if !ml.Ready() {
		t.Fatal("mailer not ready — check SMTP_* env")
	}

	ctx := context.Background()
	pool, err := db.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(pool.Close)
	_, thisFile, _, _ := runtime.Caller(0)
	migDir := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "..", "migrations"))
	if err := db.Migrate(ctx, pool, migDir); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	var mu sync.Mutex
	last := map[string]string{}
	svc := New(store.New(pool), envOr("JWT_SECRET", "dev-change-me-in-production-32chars")).
		WithMailer(ml).
		WithPublicAppURL(envOr("PUBLIC_APP_URL", "http://localhost:5173"))
	svc.captureActionToken = func(purpose, raw string) {
		mu.Lock()
		last[purpose] = raw
		mu.Unlock()
	}

	user, err := svc.store.GetUserByEmail(ctx, email)
	if err != nil || user == nil {
		t.Fatalf("test user %s must already exist: %v", email, err)
	}

	// Resolve current password (re-runnable if a previous live run already rotated).
	currentPass := passA
	if _, err := svc.Login(ctx, email, passA, "127.0.0.1", "smtp-live-e2e"); err != nil {
		if _, errB := svc.Login(ctx, email, passB, "127.0.0.1", "smtp-live-e2e"); errB != nil {
			t.Fatalf("cannot login with either configured test password")
		}
		currentPass = passB
		passB = envOr("SMTP_LIVE_NEXT_PASSWORD", "SalonXTest03!")
	}
	wasVerified := user.EmailVerified
	login1, err := svc.Login(ctx, email, currentPass, "127.0.0.1", "smtp-live-e2e")
	if err != nil {
		t.Fatalf("login before reset: %v", err)
	}
	oldRefresh := login1.RefreshToken
	if !wasVerified {
		t.Log("PASS: unverified email can login")
	} else {
		t.Log("PASS: login ok (already verified from prior run)")
	}

	// --- AUTH-01 request (real SMTP) ---
	ack, err := svc.RequestPasswordReset(ctx, email, "203.0.113.50")
	if err != nil {
		t.Fatalf("password reset request: %v", err)
	}
	if ack != passwordResetAck {
		t.Fatalf("unexpected ack")
	}
	mu.Lock()
	resetTok := last[domain.AuthPurposePasswordReset]
	mu.Unlock()
	if resetTok == "" {
		t.Fatal("reset token was not captured (mail path may have skipped)")
	}
	t.Log("PASS: password reset email path accepted by mailer (token not printed)")

	if err := svc.ConfirmPasswordReset(ctx, resetTok, passB, "203.0.113.50"); err != nil {
		t.Fatalf("confirm reset: %v", err)
	}
	t.Log("PASS: password reset confirm")

	if _, err := svc.Login(ctx, email, currentPass, "127.0.0.1", "smtp-live-e2e"); err == nil {
		t.Fatal("old password must fail")
	}
	t.Log("PASS: old password rejected")

	login2, err := svc.Login(ctx, email, passB, "127.0.0.1", "smtp-live-e2e")
	if err != nil {
		t.Fatalf("login with new password: %v", err)
	}
	t.Log("PASS: new password works")

	if _, err := svc.Refresh(ctx, oldRefresh); err == nil {
		t.Fatal("pre-reset refresh must be revoked")
	}
	t.Log("PASS: pre-reset session revoked")

	if err := svc.ConfirmPasswordReset(ctx, resetTok, "AnotherPass99!", "203.0.113.50"); err == nil {
		t.Fatal("reset token reuse must fail")
	}
	t.Log("PASS: reset token reuse rejected")

	// --- AUTH-02 ---
	if err := svc.RequestEmailVerification(ctx, login2.User.ID, "203.0.113.51"); err != nil {
		t.Fatalf("email verify request: %v", err)
	}
	mu.Lock()
	verifyTok := last[domain.AuthPurposeEmailVerify]
	mu.Unlock()
	if !login2.User.EmailVerified && verifyTok == "" {
		t.Fatal("verify token missing")
	}
	if verifyTok != "" {
		t.Log("PASS: email verification email path accepted by mailer")
		if err := svc.ConfirmEmailVerification(ctx, verifyTok); err != nil {
			t.Fatalf("confirm verify: %v", err)
		}
		if err := svc.ConfirmEmailVerification(ctx, verifyTok); err == nil {
			t.Fatal("verify token reuse must fail")
		}
		t.Log("PASS: verify token reuse rejected")
	} else {
		t.Log("PASS: email already verified — resend was idempotent (no new token)")
	}
	me, err := svc.Me(ctx, login2.User.ID)
	if err != nil || me == nil || !me.EmailVerified {
		t.Fatalf("email_verified want true: %v %#v", err, me)
	}
	t.Log("PASS: email_verified=true")

	if _, err := svc.Login(ctx, email, passB, "127.0.0.1", "smtp-live-e2e"); err != nil {
		t.Fatalf("login after verify: %v", err)
	}
	t.Log("PASS: login still works after verify")
}

func envOr(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}
