package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/auth"
	"github.com/zlobin/zlobin-beauty/backend/shared/db"
	"github.com/zlobin/zlobin-beauty/backend/shared/mailer"
)

func identityTestService(t *testing.T) (*Service, *mailer.Mock) {
	t.Helper()
	dsn := os.Getenv("IDENTITY_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("IDENTITY_DATABASE_URL / DATABASE_URL not set; skip auth action integration")
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	_, thisFile, _, _ := runtime.Caller(0)
	migDir := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "..", "migrations"))
	if err := db.Migrate(ctx, pool, migDir); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	ml := mailer.NewMock(true)
	svc := New(store.New(pool), "test-jwt-secret-key-32-characters!!").
		WithMailer(ml).
		WithPublicAppURL("http://localhost:5173")
	return svc, ml
}

func tokenFromMail(t *testing.T, m *mailer.Mock) string {
	t.Helper()
	msg, ok := m.Last()
	if !ok {
		t.Fatal("expected mail")
	}
	re := regexp.MustCompile(`token=([A-Za-z0-9_-]+)`)
	match := re.FindStringSubmatch(msg.Text)
	if len(match) < 2 {
		match = re.FindStringSubmatch(msg.HTML)
	}
	if len(match) < 2 {
		t.Fatalf("token not found in mail: %q / %q", msg.Text, msg.HTML)
	}
	return match[1]
}

func asAppErr(t *testing.T, err error) *apperr.AppError {
	t.Helper()
	var ae *apperr.AppError
	if !errors.As(err, &ae) {
		t.Fatalf("want AppError, got %T %v", err, err)
	}
	return ae
}

func TestPasswordResetEnumerationSafe(t *testing.T) {
	svc, ml := identityTestService(t)
	ctx := context.Background()
	ackUnknown, err := svc.RequestPasswordReset(ctx, "nobody-exists-"+time.Now().Format("150405")+"@example.com", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	email := "reset.known." + time.Now().Format("150405.000") + "@example.com"
	if _, err := svc.Register(ctx, RegisterInput{Email: email, Password: "Password123!", DisplayName: "Reset User"}); err != nil {
		t.Fatal(err)
	}
	ml.Reset()
	ackKnown, err := svc.RequestPasswordReset(ctx, email, "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	if ackKnown != ackUnknown || ackKnown != passwordResetAck {
		t.Fatalf("acks must match: known=%q unknown=%q", ackKnown, ackUnknown)
	}
}

func TestPasswordResetFlowRevokesSessionsAndInvalidatesOldToken(t *testing.T) {
	svc, ml := identityTestService(t)
	ctx := context.Background()
	email := "reset.flow." + time.Now().Format("150405.000") + "@example.com"
	oldPass := "Password123!"
	auth1, err := svc.Register(ctx, RegisterInput{Email: email, Password: oldPass, DisplayName: "Flow"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RequestPasswordReset(ctx, email, "10.0.0.1"); err != nil {
		t.Fatal(err)
	}
	tok1 := tokenFromMail(t, ml)
	ml.Reset()
	if _, err := svc.RequestPasswordReset(ctx, email, "10.0.0.1"); err != nil {
		t.Fatal(err)
	}
	tok2 := tokenFromMail(t, ml)
	if tok1 == tok2 {
		t.Fatal("reissue must produce a new token")
	}
	if err := svc.ConfirmPasswordReset(ctx, tok1, "NewPassword456!", "10.0.0.1"); err == nil {
		t.Fatal("previous token must be invalid after reissue")
	}
	newPass := "NewPassword456!"
	if err := svc.ConfirmPasswordReset(ctx, tok2, newPass, "10.0.0.1"); err != nil {
		t.Fatal(err)
	}
	if err := svc.ConfirmPasswordReset(ctx, tok2, "AnotherPass789!", "10.0.0.1"); err == nil {
		t.Fatal("reuse must be rejected")
	}
	if _, err := svc.Login(ctx, email, oldPass, "10.0.0.1", "test"); err == nil {
		t.Fatal("old password must fail")
	}
	if _, err := svc.Login(ctx, email, newPass, "10.0.0.1", "test"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Refresh(ctx, auth1.RefreshToken); err == nil {
		t.Fatal("pre-reset session must be revoked")
	}
	user, err := svc.store.GetUserByEmail(ctx, email)
	if err != nil || user == nil {
		t.Fatal(err)
	}
	if !auth.VerifyPassword(user.PasswordHash, newPass) {
		t.Fatal("password must be Argon2id-verifiable")
	}
}

func TestPasswordResetExpiredToken(t *testing.T) {
	svc, ml := identityTestService(t)
	ctx := context.Background()
	email := "reset.exp." + time.Now().Format("150405.000") + "@example.com"
	if _, err := svc.Register(ctx, RegisterInput{Email: email, Password: "Password123!", DisplayName: "Exp"}); err != nil {
		t.Fatal(err)
	}
	base := time.Now().UTC()
	svc.now = func() time.Time { return base }
	if _, err := svc.RequestPasswordReset(ctx, email, "10.0.0.2"); err != nil {
		t.Fatal(err)
	}
	tok := tokenFromMail(t, ml)
	svc.now = func() time.Time { return base.Add(passwordResetTTL + time.Minute) }
	if err := svc.ConfirmPasswordReset(ctx, tok, "NewPassword456!", "10.0.0.2"); err == nil {
		t.Fatal("expired token must be rejected")
	}
}

func TestPasswordResetRateLimit(t *testing.T) {
	svc, _ := identityTestService(t)
	ctx := context.Background()
	email := "reset.rl." + time.Now().Format("150405.000") + "@example.com"
	ip := "203.0.113." + time.Now().Format("05")
	var last error
	for i := 0; i < authActionMax+2; i++ {
		_, last = svc.RequestPasswordReset(ctx, email, ip)
	}
	ae := asAppErr(t, last)
	if ae.Code != apperr.CodeRateLimited {
		t.Fatalf("want rate_limited, got %s", ae.Code)
	}
}

func TestEmailVerifyFlow(t *testing.T) {
	svc, ml := identityTestService(t)
	ctx := context.Background()
	email := "verify.flow." + time.Now().Format("150405.000") + "@example.com"
	res, err := svc.Register(ctx, RegisterInput{Email: email, Password: "Password123!", DisplayName: "Verify"})
	if err != nil {
		t.Fatal(err)
	}
	if res.User.EmailVerified {
		t.Fatal("new users start unverified")
	}
	// Unverified must still login.
	if _, err := svc.Login(ctx, email, "Password123!", "10.0.0.3", "test"); err != nil {
		t.Fatal(err)
	}
	if err := svc.RequestEmailVerification(ctx, res.User.ID, "10.0.0.3"); err != nil {
		t.Fatal(err)
	}
	tok := tokenFromMail(t, ml)
	if err := svc.ConfirmEmailVerification(ctx, tok); err != nil {
		t.Fatal(err)
	}
	if err := svc.ConfirmEmailVerification(ctx, tok); err == nil {
		t.Fatal("reuse must fail")
	}
	me, err := svc.Me(ctx, res.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !me.EmailVerified {
		t.Fatal("email_verified must be true")
	}
}

func TestEmailVerifyExpiredAndMailerMissing(t *testing.T) {
	svc, ml := identityTestService(t)
	ctx := context.Background()
	email := "verify.exp." + time.Now().Format("150405.000") + "@example.com"
	res, err := svc.Register(ctx, RegisterInput{Email: email, Password: "Password123!", DisplayName: "VExp"})
	if err != nil {
		t.Fatal(err)
	}
	base := time.Now().UTC()
	svc.now = func() time.Time { return base }
	if err := svc.RequestEmailVerification(ctx, res.User.ID, "10.0.0.4"); err != nil {
		t.Fatal(err)
	}
	tok := tokenFromMail(t, ml)
	svc.now = func() time.Time { return base.Add(emailVerifyTTL + time.Hour) }
	if err := svc.ConfirmEmailVerification(ctx, tok); err == nil {
		t.Fatal("expired verify token must fail")
	}

	svc2, _ := identityTestService(t)
	svc2.mailer = mailer.NewMock(false)
	res2, err := svc2.Register(ctx, RegisterInput{
		Email: "verify.nomail." + time.Now().Format("150405.000") + "@example.com",
		Password: "Password123!", DisplayName: "NoMail",
	})
	if err != nil {
		t.Fatal(err)
	}
	err = svc2.RequestEmailVerification(ctx, res2.User.ID, "10.0.0.5")
	ae := asAppErr(t, err)
	if ae.Code != apperr.CodeConflict {
		t.Fatalf("want conflict when mailer missing, got %s", ae.Code)
	}
}

func TestNewActionTokenEntropy(t *testing.T) {
	a, err := newActionToken()
	if err != nil {
		t.Fatal(err)
	}
	b, err := newActionToken()
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Fatal("tokens must differ")
	}
	// 32 bytes raw → ~43 chars base64url without padding
	if len(a) < 40 {
		t.Fatalf("token too short: %d", len(a))
	}
}

func TestAuthActionTTLConstants(t *testing.T) {
	if passwordResetTTL < 30*time.Minute || passwordResetTTL > 60*time.Minute {
		t.Fatalf("password reset TTL must be 30–60m, got %s", passwordResetTTL)
	}
	if emailVerifyTTL < time.Hour {
		t.Fatalf("email verify TTL too short: %s", emailVerifyTTL)
	}
}

func TestAppLink(t *testing.T) {
	s := &Service{publicAppURL: "https://app.example.com"}
	link := s.appLink("/reset-password", "abc")
	if !strings.Contains(link, "https://app.example.com/reset-password?token=abc") {
		t.Fatalf("got %s", link)
	}
}

func TestAuthPurposeConstants(t *testing.T) {
	if domain.AuthPurposePasswordReset != "password_reset" || domain.AuthPurposeEmailVerify != "email_verify" {
		t.Fatal("purpose constants drifted")
	}
}
