package httpapi

import (
	"net/http"

	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerPushRoutes(mux *http.ServeMux, auth func(http.Handler) http.Handler) {
	mux.Handle("GET /v1/push/config", auth(http.HandlerFunc(a.pushConfig)))
	mux.Handle("PUT /v1/push/subscription", auth(http.HandlerFunc(a.savePushSubscription)))
	mux.Handle("DELETE /v1/push/subscription", auth(http.HandlerFunc(a.deletePushSubscription)))
}

func (a *API) pushConfig(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{
		"enabled":    a.svc.PushEnabled(),
		"public_key": a.svc.PushPublicKey(),
	})
}

func (a *API) savePushSubscription(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	if err := a.svc.SavePushSubscription(r.Context(), claims.UserID, req.Endpoint, req.Keys.P256dh, req.Keys.Auth); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) deletePushSubscription(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		Endpoint string `json:"endpoint"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	if err := a.svc.RemovePushSubscription(r.Context(), claims.UserID, req.Endpoint); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
