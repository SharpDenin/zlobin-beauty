package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerDirectoryRoutes(mux *http.ServeMux, internal func(http.Handler) http.Handler) {
	mux.Handle("GET /v1/internal/users/search", internal(http.HandlerFunc(a.internalUsersSearch)))
	mux.Handle("GET /v1/internal/users/batch", internal(http.HandlerFunc(a.internalUsersBatch)))
	mux.Handle("GET /v1/internal/users/resolve", internal(http.HandlerFunc(a.internalUsersResolve)))
}

func (a *API) internalUsersSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	limit := 10
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil {
		limit = n
	}
	items, err := a.svc.SearchDirectory(r.Context(), q, limit)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": directoryDTOs(items)})
}

func (a *API) internalUsersBatch(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("ids"))
	var ids []uuid.UUID
	if raw != "" {
		for _, part := range strings.Split(raw, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			id, err := uuid.Parse(part)
			if err != nil {
				httpx.WriteError(w, r, a.log, apperr.Validation("invalid ids"))
				return
			}
			ids = append(ids, id)
		}
	}
	items, err := a.svc.BatchDirectory(r.Context(), ids)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": directoryDTOs(items)})
}

func (a *API) internalUsersResolve(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var userID *uuid.UUID
	if raw := strings.TrimSpace(q.Get("user_id")); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid user_id"))
			return
		}
		userID = &id
	}
	u, err := a.svc.ResolveDirectory(r.Context(), userID, q.Get("email"), q.Get("phone"))
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, directoryDTO(*u))
}

func directoryDTOs(items []service.DirectoryPublicUser) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, u := range items {
		out = append(out, directoryDTO(u))
	}
	return out
}

func directoryDTO(u service.DirectoryPublicUser) map[string]any {
	roles := u.Roles
	if roles == nil {
		roles = []string{}
	}
	return map[string]any{
		"id": u.ID.String(), "display_name": u.DisplayName, "roles": roles, "city": u.City,
	}
}
