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
	"github.com/zlobin/zlobin-beauty/backend/shared/entitlement"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type Service struct {
	store          *store.Store
	jwtSecret      string
	allowDevBilling bool
	now            func() time.Time
}

func New(st *store.Store, jwtSecret string) *Service {
	return &Service{store: st, jwtSecret: jwtSecret, now: time.Now}
}

func (s *Service) WithDevBilling(allow bool) *Service {
	s.allowDevBilling = allow
	return s
}

func (s *Service) AllowDevBilling() bool {
	return s.allowDevBilling
}

type RegisterInput struct {
	Email          string
	Phone          string
	Password       string
	DisplayName    string
	AsMaster       bool
	AsSupplier     bool
	AsSupplierRep  bool
	AsSalonAdmin   bool
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
	flags := 0
	if in.AsMaster {
		flags++
	}
	if in.AsSupplier {
		flags++
	}
	if in.AsSupplierRep {
		flags++
	}
	if in.AsSalonAdmin {
		flags++
	}
	if flags > 1 {
		return nil, apperr.Validation("choose a single professional role")
	}
	now := s.now().UTC()
	roles := []string{domain.RoleClient}
	if in.AsMaster {
		roles = append(roles, domain.RoleMaster)
	}
	if in.AsSupplier {
		roles = append(roles, domain.RoleSupplier)
	}
	if in.AsSupplierRep {
		roles = append(roles, domain.RoleSupplierRep)
	}
	if in.AsSalonAdmin {
		roles = append(roles, domain.RoleSalonAdmin, domain.RoleMaster)
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
	if err := s.startPremiumTrial(ctx, user.ID, now); err != nil {
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

type UpdateProfileInput struct {
	DisplayName *string
	City        *string
}

func (s *Service) UpdateProfile(ctx context.Context, userID uuid.UUID, in UpdateProfileInput) (*domain.User, error) {
	user, err := s.Me(ctx, userID)
	if err != nil {
		return nil, err
	}
	if in.DisplayName != nil {
		name := strings.TrimSpace(*in.DisplayName)
		if name == "" {
			return nil, apperr.Validation("display_name cannot be empty")
		}
		user.DisplayName = name
	}
	if in.City != nil {
		user.City = strings.TrimSpace(*in.City)
	}
	user.UpdatedAt = s.now().UTC()
	if err := s.store.UpdateUserProfile(ctx, user.ID, user.DisplayName, user.City, user.UpdatedAt); err != nil {
		return nil, apperr.Internal(err)
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

func (s *Service) startPremiumTrial(ctx context.Context, userID uuid.UUID, now time.Time) error {
	plan, status, start, end := entitlement.TrialForNewUser(now)
	sub := domain.Subscription{
		UserID: userID, Plan: plan, Status: status,
		TrialStartedAt: &start, TrialEndsAt: &end, StartedAt: &start,
		CreatedAt: now, UpdatedAt: now,
	}
	return s.store.UpsertSubscription(ctx, sub)
}

func (s *Service) SubscriptionFor(ctx context.Context, userID uuid.UUID) (entitlement.Snapshot, error) {
	sub, err := s.store.GetSubscription(ctx, userID)
	if err != nil {
		return entitlement.Snapshot{}, apperr.Internal(err)
	}
	now := s.now().UTC()
	if sub == nil {
		if err := s.startPremiumTrial(ctx, userID, now); err != nil {
			return entitlement.Snapshot{}, apperr.Internal(err)
		}
		sub, err = s.store.GetSubscription(ctx, userID)
		if err != nil || sub == nil {
			return entitlement.Snapshot{}, apperr.Internal(err)
		}
	}
	snap := entitlement.Evaluate(sub.Plan, sub.Status, sub.TrialEndsAt, sub.PaidUntil, now)
	snap.TrialStartedAt = sub.TrialStartedAt
	snap.TrialEndsAt = sub.TrialEndsAt
	snap.StartedAt = sub.StartedAt
	snap.PaidUntil = sub.PaidUntil
	snap.CancelledAt = sub.CancelledAt
	if snap.Status == entitlement.StatusExpired && sub.Status != entitlement.StatusExpired && sub.Status != entitlement.StatusCancelled {
		sub.Plan = entitlement.PlanFree
		sub.Status = entitlement.StatusExpired
		sub.UpdatedAt = now
		_ = s.store.UpsertSubscription(ctx, *sub)
	}
	return snap, nil
}

func (s *Service) HasFeature(ctx context.Context, userID uuid.UUID, feature string) (bool, error) {
	snap, err := s.SubscriptionFor(ctx, userID)
	if err != nil {
		return false, err
	}
	return snap.Has(feature), nil
}

type DevBillingInput struct {
	Plan      string
	Status    string
	PaidUntil *time.Time
	TrialEnds *time.Time
}

func (s *Service) DevSetSubscription(ctx context.Context, actor uuid.UUID, in DevBillingInput) (entitlement.Snapshot, error) {
	if !s.allowDevBilling {
		return entitlement.Snapshot{}, apperr.Forbidden("dev billing is disabled")
	}
	plan := strings.TrimSpace(in.Plan)
	status := strings.TrimSpace(in.Status)
	if plan != entitlement.PlanFree && plan != entitlement.PlanPremium {
		return entitlement.Snapshot{}, apperr.Validation("plan must be free or premium")
	}
	switch status {
	case entitlement.StatusTrial, entitlement.StatusActive, entitlement.StatusExpired, entitlement.StatusCancelled:
	default:
		return entitlement.Snapshot{}, apperr.Validation("invalid status")
	}
	now := s.now().UTC()
	existing, err := s.store.GetSubscription(ctx, actor)
	if err != nil {
		return entitlement.Snapshot{}, apperr.Internal(err)
	}
	sub := domain.Subscription{UserID: actor, Plan: plan, Status: status, CreatedAt: now, UpdatedAt: now}
	if existing != nil {
		sub = *existing
		sub.Plan, sub.Status, sub.UpdatedAt = plan, status, now
	}
	if in.PaidUntil != nil {
		sub.PaidUntil = in.PaidUntil
	}
	if in.TrialEnds != nil {
		sub.TrialEndsAt = in.TrialEnds
	}
	switch status {
	case entitlement.StatusTrial:
		if sub.TrialStartedAt == nil {
			sub.TrialStartedAt = &now
		}
		if sub.TrialEndsAt == nil || !sub.TrialEndsAt.After(now) {
			end := now.AddDate(0, 3, 0)
			sub.TrialEndsAt = &end
		}
	case entitlement.StatusActive:
		if sub.PaidUntil == nil || !sub.PaidUntil.After(now) {
			end := now.AddDate(1, 0, 0)
			sub.PaidUntil = &end
		}
	case entitlement.StatusExpired:
		past := now.Add(-24 * time.Hour)
		sub.TrialEndsAt = &past
		sub.PaidUntil = &past
	case entitlement.StatusCancelled:
		sub.CancelledAt = &now
	}
	if err := s.store.UpsertSubscription(ctx, sub); err != nil {
		return entitlement.Snapshot{}, apperr.Internal(err)
	}
	meta, _ := json.Marshal(map[string]any{"plan": plan, "status": status})
	_ = s.store.AddAudit(ctx, ids.New(), actor, "subscription.dev_set", "subscription", &actor, meta, now)
	return s.SubscriptionFor(ctx, actor)
}

func (s *Service) GrantRole(ctx context.Context, email, role string) (*domain.User, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	role = strings.TrimSpace(role)
	allowed := map[string]struct{}{
		domain.RoleMaster: {}, domain.RoleSupplier: {}, domain.RoleSupplierRep: {},
		domain.RoleSalonOwner: {}, domain.RoleSalonAdmin: {}, domain.RoleClient: {},
	}
	if _, ok := allowed[role]; !ok {
		return nil, apperr.Validation("unsupported role")
	}
	user, err := s.store.GetUserByEmail(ctx, email)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if user == nil {
		return nil, apperr.NotFound("user not found")
	}
	if err := s.store.AddUserRole(ctx, user.ID, role); err != nil {
		return nil, apperr.Internal(err)
	}
	meta, _ := json.Marshal(map[string]any{"role": role, "email": email})
	_ = s.store.AddAudit(ctx, ids.New(), user.ID, "role.granted", "user", &user.ID, meta, s.now().UTC())
	return s.Me(ctx, user.ID)
}

func (s *Service) LookupByEmail(ctx context.Context, email string) (*domain.User, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" {
		return nil, apperr.Validation("email is required")
	}
	user, err := s.store.GetUserByEmail(ctx, email)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if user == nil {
		return nil, apperr.NotFound("user not found")
	}
	return user, nil
}

func defaultWidgets() []byte {
	return []byte(`[
	  {"id":"alerts","type":"important_messages","x":0,"y":0,"w":12,"h":2},
	  {"id":"calendar","type":"calendar","x":0,"y":2,"w":8,"h":6},
	  {"id":"upcoming","type":"upcoming","x":8,"y":2,"w":4,"h":3},
	  {"id":"today","type":"today","x":8,"y":5,"w":4,"h":3}
	]`)
}

func (s *Service) GetDashboard(ctx context.Context, userID uuid.UUID) ([]byte, error) {
	d, err := s.store.GetDashboard(ctx, userID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if d == nil || len(d.Widgets) == 0 {
		return defaultWidgets(), nil
	}
	return d.Widgets, nil
}

func (s *Service) SaveDashboard(ctx context.Context, userID uuid.UUID, widgets []byte) error {
	if !json.Valid(widgets) {
		return apperr.Validation("widgets must be valid JSON")
	}
	var parsed []map[string]any
	if err := json.Unmarshal(widgets, &parsed); err != nil {
		return apperr.Validation("widgets must be an array")
	}
	allowed := map[string]struct{}{
		"calendar": {}, "upcoming": {}, "today": {}, "important_messages": {},
		"tasks": {}, "clients_today": {}, "orders": {},
	}
	allowedSize := map[string]struct{}{"2x2": {}, "4x2": {}, "4x3": {}, "8x3": {}, "8x6": {}, "12x2": {}, "12x4": {}}
	for _, w := range parsed {
		typ, _ := w["type"].(string)
		if _, ok := allowed[typ]; !ok {
			return apperr.Validation("unsupported widget type")
		}
		if size, ok := w["size"].(string); ok && size != "" {
			if _, ok := allowedSize[size]; !ok {
				return apperr.Validation("unsupported widget size")
			}
		}
	}
	if err := s.store.UpsertDashboard(ctx, userID, widgets, s.now().UTC()); err != nil {
		return apperr.Internal(err)
	}
	return nil
}

func (s *Service) GetHintPrefs(ctx context.Context, userID uuid.UUID) (bool, []string, error) {
	p, err := s.store.GetHintPrefs(ctx, userID)
	if err != nil {
		return false, nil, apperr.Internal(err)
	}
	if p == nil {
		return true, []string{}, nil
	}
	var dismissed []string
	if len(p.Dismissed) > 0 {
		_ = json.Unmarshal(p.Dismissed, &dismissed)
	}
	if dismissed == nil {
		dismissed = []string{}
	}
	return p.HintsEnabled, dismissed, nil
}

func (s *Service) UpdateHintPrefs(ctx context.Context, userID uuid.UUID, enabled *bool, dismissKey string) (bool, []string, error) {
	on, dismissed, err := s.GetHintPrefs(ctx, userID)
	if err != nil {
		return false, nil, err
	}
	if enabled != nil {
		on = *enabled
	}
	if key := strings.TrimSpace(dismissKey); key != "" {
		found := false
		for _, d := range dismissed {
			if d == key {
				found = true
				break
			}
		}
		if !found {
			dismissed = append(dismissed, key)
		}
	}
	b, _ := json.Marshal(dismissed)
	if err := s.store.UpsertHintPrefs(ctx, domain.HintPrefs{
		UserID: userID, HintsEnabled: on, Dismissed: b, UpdatedAt: s.now().UTC(),
	}); err != nil {
		return false, nil, apperr.Internal(err)
	}
	return on, dismissed, nil
}
