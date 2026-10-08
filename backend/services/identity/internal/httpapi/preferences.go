package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerPreferenceRoutes(mux *http.ServeMux, authMW func(http.Handler) http.Handler) {
	mux.Handle("GET /v1/me/preferences", authMW(http.HandlerFunc(a.listPreferences)))
	mux.Handle("PUT /v1/me/preferences/{key}", authMW(http.HandlerFunc(a.putPreference)))
	mux.Handle("DELETE /v1/me/preferences/{key}", authMW(http.HandlerFunc(a.deletePreference)))
}

func (a *API) listPreferences(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	items, err := a.svc.ListPreferences(r.Context(), claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	prefs := make(map[string]json.RawMessage, len(items))
	for _, it := range items {
		prefs[it.Key] = it.Value
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"preferences": prefs})
}

func (a *API) putPreference(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		Value json.RawMessage `json:"value"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	pref, err := a.svc.SetPreference(r.Context(), claims.UserID, r.PathValue("key"), req.Value)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, pref)
}

func (a *API) deletePreference(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	if err := a.svc.DeletePreference(r.Context(), claims.UserID, r.PathValue("key")); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
