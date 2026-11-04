package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/auth"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
	"github.com/zlobin/zlobin-beauty/backend/shared/mailer"
)

const (
	passwordResetTTL = 45 * time.Minute
	emailVerifyTTL   = 24 * time.Hour
	authActionWindow = 15 * time.Minute
	authActionMax    = 5
)

// Generic acknowledgement — same for known and unknown emails (AUTH-01 enumeration safety).
const passwordResetAck = "Если аккаунт с таким email существует, мы отправили инструкции по восстановлению пароля."

func (s *Service) WithMailer(m mailer.Mailer) *Service {
	s.mailer = m
	return s
}

func (s *Service) WithPublicAppURL(url string) *Service {
	s.publicAppURL = strings.TrimRight(strings.TrimSpace(url), "/")
	return s
}

func (s *Service) WithLogger(log *slog.Logger) *Service {
	s.log = log
	return s
}

func (s *Service) MailerReady() bool {
	return s.mailer != nil && s.mailer.Ready()
}

// RequestPasswordReset always returns the same acknowledgement. Never reveals account existence.
func (s *Service) RequestPasswordReset(ctx context.Context, email, ip string) (string, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" || !strings.Contains(email, "@") {
		return "", apperr.Validation("invalid email")
	}
	now := s.now().UTC()
	if err := s.enforceAuthActionRate(ctx, "pwd_reset:"+hashKey(email), ip, now); err != nil {
		return "", err
	}
	_ = s.store.AddLoginAttempt(ctx, "pwd_reset:"+hashKey(email), false, now)

	user, err := s.store.GetUserByEmail(ctx, email)
	if err != nil {
		return "", apperr.Internal(err)
	}
	if user == nil || user.Status != "active" {
		return passwordResetAck, nil
	}
	if s.mailer == nil || !s.mailer.Ready() {
		s.warn("password_reset skipped: mailer not configured")
		_ = s.security(ctx, &user.ID, "password_reset.mailer_missing", map[string]any{})
		return passwordResetAck, nil
	}
	raw, err := s.issueActionToken(ctx, user.ID, domain.AuthPurposePasswordReset, passwordResetTTL, now)
	if err != nil {
		return "", err
	}
	link := s.appLink("/reset-password", raw)
	msg := mailer.Message{
		To:      []string{email},
		Subject: "Восстановление пароля Salon-X",
		Text:    fmt.Sprintf("Здравствуйте!\n\nЧтобы задать новый пароль, откройте ссылку (действует около 45 минут):\n%s\n\nЕсли вы не запрашивали восстановление, просто проигнорируйте это письмо.\n", link),
		HTML:    fmt.Sprintf(`<p>Здравствуйте!</p><p>Чтобы задать новый пароль, перейдите по <a href="%s">ссылке</a>.</p><p>Ссылка действует около 45 минут. Если вы не запрашивали восстановление, проигнорируйте это письмо.</p>`, htmlAttr(link)),
	}
	if err := s.mailer.Send(ctx, msg); err != nil {
		s.warn("password_reset send failed", "error", err.Error())
		_ = s.security(ctx, &user.ID, "password_reset.send_failed", map[string]any{})
		// Still return generic ack — do not leak delivery/config state to anonymous callers.
		return passwordResetAck, nil
	}
	_ = s.security(ctx, &user.ID, "password_reset.requested", map[string]any{})
	return passwordResetAck, nil
}

// ConfirmPasswordReset sets a new password and revokes all sessions.
func (s *Service) ConfirmPasswordReset(ctx context.Context, rawToken, newPassword, ip string) error {
	rawToken = strings.TrimSpace(rawToken)
	if rawToken == "" {
		return apperr.Validation("token is required")
	}
	if len(newPassword) < 8 {
		return apperr.Validation("password must be at least 8 characters")
	}
	now := s.now().UTC()
	if err := s.enforceAuthActionRate(ctx, "pwd_confirm:"+hashKey(ip), ip, now); err != nil {
		return err
	}
	tok, err := s.loadValidToken(ctx, domain.AuthPurposePasswordReset, rawToken, now)
	if err != nil {
		return err
	}
	hash, err := auth.HashPassword(newPassword)
	if err != nil {
		return apperr.Internal(err)
	}
	ok, err := s.store.MarkAuthActionTokenUsed(ctx, tok.ID, now)
	if err != nil {
		return apperr.Internal(err)
	}
	if !ok {
		return apperr.Validation("invalid or expired token")
	}
	if err := s.store.UpdatePasswordHash(ctx, tok.UserID, hash, now); err != nil {
		return apperr.Internal(err)
	}
	_ = s.store.RevokeSessionsForUser(ctx, tok.UserID, now)
	_ = s.security(ctx, &tok.UserID, "password_reset.completed", map[string]any{})
	return nil
}

// RequestEmailVerification sends a confirmation link. Requires an authenticated user with email.
func (s *Service) RequestEmailVerification(ctx context.Context, userID uuid.UUID, ip string) error {
	now := s.now().UTC()
	if err := s.enforceAuthActionRate(ctx, "email_verify:"+userID.String(), ip, now); err != nil {
		return err
	}
	user, err := s.store.GetUserByID(ctx, userID)
	if err != nil {
		return apperr.Internal(err)
	}
	if user == nil {
		return apperr.NotFound("user not found")
	}
	if user.Email == nil || strings.TrimSpace(*user.Email) == "" {
		return apperr.Validation("email is required")
	}
	if user.EmailVerified {
		return nil // idempotent success
	}
	if s.mailer == nil || !s.mailer.Ready() {
		return apperr.Conflict("email delivery is not configured")
	}
	raw, err := s.issueActionToken(ctx, user.ID, domain.AuthPurposeEmailVerify, emailVerifyTTL, now)
	if err != nil {
		return err
	}
	email := *user.Email
	link := s.appLink("/verify-email", raw)
	msg := mailer.Message{
		To:      []string{email},
		Subject: "Подтверждение email Salon-X",
		Text:    fmt.Sprintf("Здравствуйте!\n\nПодтвердите email, открыв ссылку:\n%s\n\nСсылка действует 24 часа.\n", link),
		HTML:    fmt.Sprintf(`<p>Здравствуйте!</p><p>Подтвердите email: <a href="%s">перейти</a>.</p><p>Ссылка действует 24 часа.</p>`, htmlAttr(link)),
	}
	if err := s.mailer.Send(ctx, msg); err != nil {
		if errors.Is(err, mailer.ErrNotConfigured) {
			return apperr.Conflict("email delivery is not configured")
		}
		s.warn("email_verify send failed", "error", err.Error())
		return apperr.Internal(fmt.Errorf("failed to send verification email"))
	}
	_ = s.security(ctx, &user.ID, "email_verify.requested", map[string]any{})
	return nil
}

// ConfirmEmailVerification marks email_verified=true.
func (s *Service) ConfirmEmailVerification(ctx context.Context, rawToken string) error {
	rawToken = strings.TrimSpace(rawToken)
	if rawToken == "" {
		return apperr.Validation("token is required")
	}
	now := s.now().UTC()
	tok, err := s.loadValidToken(ctx, domain.AuthPurposeEmailVerify, rawToken, now)
	if err != nil {
		return err
	}
	ok, err := s.store.MarkAuthActionTokenUsed(ctx, tok.ID, now)
	if err != nil {
		return apperr.Internal(err)
	}
	if !ok {
		return apperr.Validation("invalid or expired token")
	}
	if err := s.store.SetEmailVerified(ctx, tok.UserID, true, now); err != nil {
		return apperr.Internal(err)
	}
	_ = s.security(ctx, &tok.UserID, "email_verify.completed", map[string]any{})
	return nil
}

func (s *Service) issueActionToken(ctx context.Context, userID uuid.UUID, purpose string, ttl time.Duration, now time.Time) (string, error) {
	if err := s.store.InvalidateActiveAuthTokens(ctx, userID, purpose, now); err != nil {
		return "", apperr.Internal(err)
	}
	raw, err := newActionToken()
	if err != nil {
		return "", apperr.Internal(err)
	}
	t := domain.AuthActionToken{
		ID: ids.New(), UserID: userID, Purpose: purpose,
		TokenHash: auth.HashToken(raw), ExpiresAt: now.Add(ttl), CreatedAt: now,
	}
	if err := s.store.InsertAuthActionToken(ctx, t); err != nil {
		return "", apperr.Internal(err)
	}
	// Optional capture for live SMTP e2e only — never log the raw token.
	if s.captureActionToken != nil {
		s.captureActionToken(purpose, raw)
	}
	return raw, nil
}

func (s *Service) loadValidToken(ctx context.Context, purpose, raw string, now time.Time) (*domain.AuthActionToken, error) {
	tok, err := s.store.GetAuthActionTokenByHash(ctx, purpose, auth.HashToken(raw))
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if tok == nil || tok.UsedAt != nil || !now.Before(tok.ExpiresAt) {
		return nil, apperr.Validation("invalid or expired token")
	}
	return tok, nil
}

func (s *Service) enforceAuthActionRate(ctx context.Context, key, ip string, now time.Time) error {
	n, err := s.store.CountRecentFailures(ctx, key, now.Add(-authActionWindow))
	if err != nil {
		return apperr.Internal(err)
	}
	if n >= authActionMax {
		return apperr.RateLimited("too many attempts")
	}
	if ip != "" {
		ipKey := "auth_ip:" + hashKey(ip)
		in, err := s.store.CountRecentFailures(ctx, ipKey, now.Add(-authActionWindow))
		if err != nil {
			return apperr.Internal(err)
		}
		if in >= authActionMax*2 {
			return apperr.RateLimited("too many attempts")
		}
		_ = s.store.AddLoginAttempt(ctx, ipKey, false, now)
	}
	return nil
}

func (s *Service) appLink(path, token string) string {
	base := s.publicAppURL
	if base == "" {
		base = "http://localhost:5173"
	}
	sep := "?"
	if strings.Contains(path, "?") {
		sep = "&"
	}
	return base + path + sep + "token=" + token
}

func (s *Service) warn(msg string, kv ...any) {
	if s.log != nil {
		s.log.Warn(msg, kv...)
	}
}

func newActionToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func hashKey(v string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(v))))
	return hex.EncodeToString(sum[:8])
}

func htmlAttr(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	return s
}
