package httpapi

import (
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

type API struct {
	svc *service.Service
	log *slog.Logger
}

func New(svc *service.Service, log *slog.Logger) *API {
	return &API{svc: svc, log: log}
}

func (a *API) Routes(mux *http.ServeMux, jwtSecret string) {
	authMW := httpx.BearerAuth(jwtSecret)
	mux.HandleFunc("POST /v1/auth/register", a.register)
	mux.HandleFunc("POST /v1/auth/login", a.login)
	mux.HandleFunc("POST /v1/auth/refresh", a.refresh)
	mux.HandleFunc("POST /v1/auth/logout", a.logout)
	mux.Handle("GET /v1/auth/me", authMW(http.HandlerFunc(a.me)))
	mux.Handle("POST /v1/auth/lookup", authMW(http.HandlerFunc(a.lookup)))
	mux.Handle("PATCH /v1/auth/me", authMW(http.HandlerFunc(a.updateMe)))
	mux.Handle("GET /v1/me/subscription", authMW(http.HandlerFunc(a.getSubscription)))
	mux.Handle("POST /v1/me/subscription/dev", authMW(http.HandlerFunc(a.devSubscription)))
	mux.Handle("GET /v1/me/dashboard", authMW(http.HandlerFunc(a.getDashboard)))
	mux.Handle("PUT /v1/me/dashboard", authMW(http.HandlerFunc(a.putDashboard)))
	mux.Handle("GET /v1/me/hints", authMW(http.HandlerFunc(a.getHints)))
	mux.Handle("PATCH /v1/me/hints", authMW(http.HandlerFunc(a.patchHints)))
	a.registerAdminRoutes(mux, authMW)
}

func (a *API) InternalRoutes(mux *http.ServeMux, internalToken string) {
	internal := httpx.InternalAuth(internalToken)
	mux.Handle("GET /v1/internal/entitlements/{userID}", internal(http.HandlerFunc(a.internalEntitlements)))
	mux.Handle("GET /v1/internal/users/{userID}", internal(http.HandlerFunc(a.internalUser)))
	mux.Handle("POST /v1/internal/users/grant-role", internal(http.HandlerFunc(a.grantRole)))
	mux.Handle("POST /v1/internal/audit", internal(http.HandlerFunc(a.ingestAudit)))
}

func (a *API) internalUser(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("userID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid user id"))
		return
	}
	user, err := a.svc.Me(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"id": user.ID.String(), "email": user.Email, "phone": user.Phone, "display_name": user.DisplayName,
	})
}

type registerReq struct {
	Email         string `json:"email"`
	Phone         string `json:"phone"`
	Password      string `json:"password"`
	DisplayName   string `json:"display_name"`
	AsMaster      bool   `json:"as_master"`
	AsSupplier    bool   `json:"as_supplier"`
	AsSupplierRep bool   `json:"as_supplier_rep"`
	AsSalonAdmin  bool   `json:"as_salon_admin"`
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type refreshReq struct {
	RefreshToken string `json:"refresh_token"`
}

type userDTO struct {
	ID          string   `json:"id"`
	Email       *string  `json:"email"`
	Phone       *string  `json:"phone"`
	DisplayName string   `json:"display_name"`
	City        string   `json:"city"`
	Roles       []string `json:"roles"`
	Status      string   `json:"status"`
}

type authResp struct {
	AccessToken      string    `json:"access_token"`
	RefreshToken     string    `json:"refresh_token"`
	AccessExpiresAt  time.Time `json:"access_expires_at"`
	RefreshExpiresAt time.Time `json:"refresh_expires_at"`
	User             userDTO   `json:"user"`
}

func toUserDTO(u domain.User) userDTO {
	roles := u.Roles
	if roles == nil {
		roles = []string{}
	}
	return userDTO{
		ID:          u.ID.String(),
		Email:       u.Email,
		Phone:       u.Phone,
		DisplayName: u.DisplayName,
		City:        u.City,
		Roles:       roles,
		Status:      u.Status,
	}
}

func (a *API) register(w http.ResponseWriter, r *http.Request) {
	var req registerReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	res, err := a.svc.Register(r.Context(), service.RegisterInput{
		Email: req.Email, Phone: req.Phone, Password: req.Password, DisplayName: req.DisplayName,
		AsMaster: req.AsMaster, AsSupplier: req.AsSupplier, AsSupplierRep: req.AsSupplierRep, AsSalonAdmin: req.AsSalonAdmin,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, authResp{
		AccessToken: res.AccessToken, RefreshToken: res.RefreshToken,
		AccessExpiresAt: res.AccessExp, RefreshExpiresAt: res.RefreshExp, User: toUserDTO(res.User),
	})
}

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	ip := clientIP(r)
	res, err := a.svc.Login(r.Context(), req.Email, req.Password, ip, r.UserAgent())
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, authResp{
		AccessToken: res.AccessToken, RefreshToken: res.RefreshToken,
		AccessExpiresAt: res.AccessExp, RefreshExpiresAt: res.RefreshExp, User: toUserDTO(res.User),
	})
}

func (a *API) refresh(w http.ResponseWriter, r *http.Request) {
	var req refreshReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	res, err := a.svc.Refresh(r.Context(), req.RefreshToken)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, authResp{
		AccessToken: res.AccessToken, RefreshToken: res.RefreshToken,
		AccessExpiresAt: res.AccessExp, RefreshExpiresAt: res.RefreshExp, User: toUserDTO(res.User),
	})
}

func (a *API) logout(w http.ResponseWriter, r *http.Request) {
	var req refreshReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	if err := a.svc.Logout(r.Context(), req.RefreshToken); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) me(w http.ResponseWriter, r *http.Request) {
	claims, ok := httpx.ClaimsFrom(r.Context())
	if !ok {
		httpx.WriteError(w, r, a.log, apperr.Unauthorized("unauthorized"))
		return
	}
	user, err := a.svc.Me(r.Context(), claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toUserDTO(*user))
}

func (a *API) lookup(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	user, err := a.svc.LookupByEmail(r.Context(), req.Email)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"user": map[string]any{
		"id": user.ID.String(), "display_name": user.DisplayName, "email": user.Email,
	}})
}

func (a *API) updateMe(w http.ResponseWriter, r *http.Request) {
	claims, ok := httpx.ClaimsFrom(r.Context())
	if !ok {
		httpx.WriteError(w, r, a.log, apperr.Unauthorized("unauthorized"))
		return
	}
	var req struct {
		DisplayName *string `json:"display_name"`
		City        *string `json:"city"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	user, err := a.svc.UpdateProfile(r.Context(), claims.UserID, service.UpdateProfileInput{
		DisplayName: req.DisplayName, City: req.City,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toUserDTO(*user))
}

func (a *API) getSubscription(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	snap, err := a.svc.SubscriptionFor(r.Context(), claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	dto := map[string]any{
		"plan": snap.Plan, "status": snap.Status, "effective_plan": snap.EffectivePlan,
		"features": snap.Features, "dev_controls": a.svc.AllowDevBilling(),
	}
	if snap.TrialStartedAt != nil {
		dto["trial_started_at"] = *snap.TrialStartedAt
	}
	if snap.TrialEndsAt != nil {
		dto["trial_ends_at"] = *snap.TrialEndsAt
	}
	if snap.StartedAt != nil {
		dto["started_at"] = *snap.StartedAt
	}
	if snap.PaidUntil != nil {
		dto["paid_until"] = *snap.PaidUntil
	}
	if snap.CancelledAt != nil {
		dto["cancelled_at"] = *snap.CancelledAt
	}
	httpx.JSON(w, http.StatusOK, dto)
}

func (a *API) devSubscription(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		Plan      string     `json:"plan"`
		Status    string     `json:"status"`
		PaidUntil *time.Time `json:"paid_until"`
		TrialEnds *time.Time `json:"trial_ends_at"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	snap, err := a.svc.DevSetSubscription(r.Context(), claims.UserID, service.DevBillingInput{
		Plan: req.Plan, Status: req.Status, PaidUntil: req.PaidUntil, TrialEnds: req.TrialEnds,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, snap)
}

func (a *API) getDashboard(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	raw, err := a.svc.GetDashboard(r.Context(), claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(append([]byte(`{"widgets":`), append(raw, '}')...))
}

func (a *API) putDashboard(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		Widgets json.RawMessage `json:"widgets"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	if err := a.svc.SaveDashboard(r.Context(), claims.UserID, req.Widgets); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) getHints(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	on, dismissed, err := a.svc.GetHintPrefs(r.Context(), claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"hints_enabled": on, "dismissed": dismissed})
}

func (a *API) patchHints(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		HintsEnabled *bool  `json:"hints_enabled"`
		Dismiss      string `json:"dismiss"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	on, dismissed, err := a.svc.UpdateHintPrefs(r.Context(), claims.UserID, req.HintsEnabled, req.Dismiss)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"hints_enabled": on, "dismissed": dismissed})
}

func (a *API) internalEntitlements(w http.ResponseWriter, r *http.Request) {
	userID, err := uuid.Parse(r.PathValue("userID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid user id"))
		return
	}
	snap, err := a.svc.SubscriptionFor(r.Context(), userID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, snap)
}

func (a *API) grantRole(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	user, err := a.svc.GrantRole(r.Context(), req.Email, req.Role)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toUserDTO(*user))
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
