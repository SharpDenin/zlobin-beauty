package httpapi

import (
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
	"log/slog"
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
	mux.Handle("PATCH /v1/auth/me", authMW(http.HandlerFunc(a.updateMe)))
}

type registerReq struct {
	Email       string `json:"email"`
	Phone       string `json:"phone"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
	AsMaster    bool   `json:"as_master"`
	AsSupplier  bool   `json:"as_supplier"`
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
		AsMaster: req.AsMaster, AsSupplier: req.AsSupplier,
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
