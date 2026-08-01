package service

import (
	"context"
	"encoding/json"
	"net"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/auth"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type Service struct {
	store     *store.Store
	jwtSecret string
	now       func() time.Time
}

func New(st *store.Store, jwtSecret string) *Service {
	return &Service{store: st, jwtSecret: jwtSecret, now: time.Now}
}

type RegisterInput struct {
	Email       string
	Phone       string
	Password    string
	DisplayName string
	AsMaster    bool
}

type AuthResult struct {
	User         domain.User
	AccessToken  string
	RefreshToken string
	AccessExp    time.Time
	RefreshExp   time.Time
}

func (s *Service) Register(ctx context.Context, in RegisterInput) (*AuthResult, error) {
	email := strings.TrimSpace(strings.ToLower(in.Email))
	phone := strings.TrimSpace(in.Phone)
	name := strings.TrimSpace(in.DisplayName)
	if email == "" && phone == "" {
		return nil, apperr.Validation("email or phone is required")
	}
	if email != "" && !strings.Contains(email, "@") {
		return nil, apperr.Validation("invalid email")
	}
	if len(in.Password) < 8 {
		return nil, apperr.Validation("password must be at least 8 characters")
	}
	if name == "" {
		return nil, apperr.Validation("display_name is required")
	}
	if email != "" {
		existing, err := s.store.GetUserByEmail(ctx, email)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if existing != nil {
			return nil, apperr.Conflict("email already registered")
		}
	}
	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	now := s.now().UTC()
	roles := []string{domain.RoleClient}
	if in.AsMaster {
		roles = append(roles, domain.RoleMaster)
	}
	var emailPtr, phonePtr *string
	if email != "" {
		emailPtr = &email
	}
	if phone != "" {
		phonePtr = &phone
	}
	user := domain.User{
		ID:           ids.New(),
		Email:        emailPtr,
		Phone:        phonePtr,
		PasswordHash: hash,
		DisplayName:  name,
		Status:       "active",
		Roles:        roles,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := s.store.CreateUser(ctx, user); err != nil {
		return nil, apperr.Internal(err)
	}
	_ = s.security(ctx, &user.ID, "user.registered", map[string]any{})
	return s.issue(ctx, user, nil, nil)
}

func (s *Service) Login(ctx context.Context, email, password, ip, ua string) (*AuthResult, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" || password == "" {
		return nil, apperr.Validation("email and password are required")
	}
	key := "login:" + email
	now := s.now().UTC()
	failures, err := s.store.CountRecentFailures(ctx, key, now.Add(-15*time.Minute))
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if failures >= 10 {
		return nil, apperr.RateLimited("too many login attempts")
	}
	user, err := s.store.GetUserByEmail(ctx, email)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if user == nil || !auth.VerifyPassword(user.PasswordHash, password) {
		_ = s.store.AddLoginAttempt(ctx, key, false, now)
		_ = s.security(ctx, nil, "login.failed", map[string]any{"email_present": true})
		return nil, apperr.Unauthorized("invalid credentials")
	}
	if user.Status != "active" {
		return nil, apperr.Forbidden("account is blocked")
	}
	_ = s.store.AddLoginAttempt(ctx, key, true, now)
	_ = s.security(ctx, &user.ID, "login.success", map[string]any{})
	var ipPtr, uaPtr *string
	if ip != "" {
		if parsed := net.ParseIP(ip); parsed != nil {
			ipPtr = &ip
		}
	}
	if ua != "" {
		uaPtr = &ua
	}
	return s.issue(ctx, *user, ipPtr, uaPtr)
}

func (s *Service) Refresh(ctx context.Context, refreshToken string) (*AuthResult, error) {
	if refreshToken == "" {
		return nil, apperr.Validation("refresh_token is required")
	}
	hash := auth.HashToken(refreshToken)
	sess, err := s.store.GetSessionByRefreshHash(ctx, hash)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	now := s.now().UTC()
	if sess == nil {
		return nil, apperr.Unauthorized("invalid refresh token")
	}
	if sess.RevokedAt != nil {
		_ = s.store.RevokeFamily(ctx, sess.FamilyID, now)
		_ = s.security(ctx, &sess.UserID, "refresh.reuse_detected", map[string]any{})
		return nil, apperr.Unauthorized("refresh token revoked")
	}
	if now.After(sess.ExpiresAt) {
		return nil, apperr.Unauthorized("refresh token expired")
	}
	user, err := s.store.GetUserByID(ctx, sess.UserID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if user == nil || user.Status != "active" {
		return nil, apperr.Forbidden("account unavailable")
	}
	pair, err := auth.IssuePair(s.jwtSecret, user.ID, user.Roles, now)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	next := domain.Session{
		ID:               pair.SessionID,
		UserID:           user.ID,
		RefreshTokenHash: pair.RefreshTokenHash,
		FamilyID:         sess.FamilyID,
		UserAgent:        sess.UserAgent,
		IP:               sess.IP,
		ExpiresAt:        pair.RefreshExpiresAt,
		CreatedAt:        now,
	}
	if err := s.store.RotateSession(ctx, sess.ID, next, now); err != nil {
		return nil, apperr.Internal(err)
	}
	return &AuthResult{
		User:         *user,
		AccessToken:  pair.AccessToken,
		RefreshToken: pair.RefreshToken,
		AccessExp:    pair.AccessExpiresAt,
		RefreshExp:   pair.RefreshExpiresAt,
	}, nil
}

func (s *Service) Logout(ctx context.Context, refreshToken string) error {
	if refreshToken == "" {
		return apperr.Validation("refresh_token is required")
	}
	sess, err := s.store.GetSessionByRefreshHash(ctx, auth.HashToken(refreshToken))
	if err != nil {
		return apperr.Internal(err)
	}
	if sess == nil {
		return nil
	}
	now := s.now().UTC()
	if err := s.store.RevokeSession(ctx, sess.ID, now); err != nil {
		return apperr.Internal(err)
	}
	_ = s.security(ctx, &sess.UserID, "logout", map[string]any{})
	return nil
}

func (s *Service) Me(ctx context.Context, userID uuid.UUID) (*domain.User, error) {
	user, err := s.store.GetUserByID(ctx, userID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if user == nil {
		return nil, apperr.NotFound("user not found")
	}
	return user, nil
}

func (s *Service) BootstrapAdmin(ctx context.Context, email, password, displayName string) (*domain.User, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	displayName = strings.TrimSpace(displayName)
	if email == "" || password == "" || displayName == "" {
		return nil, apperr.Validation("BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD, BOOTSTRAP_ADMIN_NAME are required")
	}
	if len(password) < 12 {
		return nil, apperr.Validation("bootstrap admin password must be at least 12 characters")
	}
	ok, err := s.store.TryAcquireBootstrap(ctx)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if !ok {
		return nil, apperr.Conflict("bootstrap already completed")
	}
	existing, err := s.store.GetUserByEmail(ctx, email)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if existing != nil {
		return nil, apperr.Conflict("admin email already exists")
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	now := s.now().UTC()
	user := domain.User{
		ID:           ids.New(),
		Email:        &email,
		PasswordHash: hash,
		DisplayName:  displayName,
		Status:       "active",
		Roles:        []string{domain.RoleSystemAdmin},
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := s.store.CreateUser(ctx, user); err != nil {
		return nil, apperr.Internal(err)
	}
	_ = s.security(ctx, &user.ID, "bootstrap.admin_created", map[string]any{})
	return &user, nil
}

func (s *Service) issue(ctx context.Context, user domain.User, ip, ua *string) (*AuthResult, error) {
	now := s.now().UTC()
	pair, err := auth.IssuePair(s.jwtSecret, user.ID, user.Roles, now)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	family := ids.New()
	sess := domain.Session{
		ID:               pair.SessionID,
		UserID:           user.ID,
		RefreshTokenHash: pair.RefreshTokenHash,
		FamilyID:         family,
		UserAgent:        ua,
		IP:               ip,
		ExpiresAt:        pair.RefreshExpiresAt,
		CreatedAt:        now,
	}
	if err := s.store.CreateSession(ctx, sess); err != nil {
		return nil, apperr.Internal(err)
	}
	return &AuthResult{
		User:         user,
		AccessToken:  pair.AccessToken,
		RefreshToken: pair.RefreshToken,
		AccessExp:    pair.AccessExpiresAt,
		RefreshExp:   pair.RefreshExpiresAt,
	}, nil
}

func (s *Service) security(ctx context.Context, userID *uuid.UUID, eventType string, meta map[string]any) error {
	b, _ := json.Marshal(meta)
	return s.store.AddSecurityEvent(ctx, ids.New(), userID, eventType, b, s.now().UTC())
}
