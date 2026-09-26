package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerAdminRoutes(mux *http.ServeMux, auth func(http.Handler) http.Handler) {
	admin := func(h http.HandlerFunc) http.Handler {
		return auth(httpx.RequireSystemAdmin(h))
	}
	mux.Handle("GET /v1/admin/stats", admin(a.adminStats))
	mux.Handle("GET /v1/admin/users", admin(a.adminListUsers))
	mux.Handle("GET /v1/admin/users/{id}", admin(a.adminGetUser))
	mux.Handle("POST /v1/admin/users/{id}/block", admin(a.adminBlockUser))
	mux.Handle("POST /v1/admin/users/{id}/unblock", admin(a.adminUnblockUser))
	mux.Handle("GET /v1/admin/audit-log", admin(a.adminListAudit))
}

func (a *API) adminStats(w http.ResponseWriter, r *http.Request) {
	st, err := a.svc.AdminUserStats(r.Context())
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"users_total": st.UsersTotal, "users_active": st.UsersActive, "users_blocked": st.UsersBlocked,
	})
}

func (a *API) adminListUsers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, offset := httpx.ParsePage(q.Get("limit"), q.Get("offset"))
	items, total, err := a.svc.AdminListUsers(r.Context(), store.UserListFilter{
		Query: q.Get("q"), Role: q.Get("role"), Status: q.Get("status"), Limit: limit, Offset: offset,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, u := range items {
		out = append(out, adminUserDTO(u, false))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out, "total": total, "limit": limit, "offset": offset})
}

func (a *API) adminGetUser(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid user id"))
		return
	}
	user, sub, err := a.svc.AdminGetUser(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	body := adminUserDTO(*user, true)
	if sub != nil {
		body["subscription"] = map[string]any{
			"plan": sub.Plan, "status": sub.Status, "trial_ends_at": sub.TrialEndsAt, "paid_until": sub.PaidUntil,
		}
	}
	httpx.JSON(w, http.StatusOK, body)
}

func (a *API) adminBlockUser(w http.ResponseWriter, r *http.Request) {
	a.adminSetStatus(w, r, "blocked")
}

func (a *API) adminUnblockUser(w http.ResponseWriter, r *http.Request) {
	a.adminSetStatus(w, r, "active")
}

func (a *API) adminSetStatus(w http.ResponseWriter, r *http.Request, status string) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid user id"))
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	user, err := a.svc.AdminSetUserStatus(r.Context(), claims.UserID, id, status, req.Reason)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, adminUserDTO(*user, true))
}

func (a *API) adminListAudit(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, offset := httpx.ParsePage(q.Get("limit"), q.Get("offset"))
	f := store.AuditListFilter{Query: q.Get("q"), EntityType: q.Get("entity_type"), Limit: limit, Offset: offset}
	if v := strings.TrimSpace(q.Get("actor_id")); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid actor_id"))
			return
		}
		f.ActorID = &id
	}
	if v := strings.TrimSpace(q.Get("from")); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid from"))
			return
		}
		f.From = &t
	}
	if v := strings.TrimSpace(q.Get("to")); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid to"))
			return
		}
		f.To = &t
	}
	items, total, err := a.svc.AdminListAudit(r.Context(), f)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, e := range items {
		item := map[string]any{
			"id": e.ID.String(), "action": e.Action, "entity_type": e.EntityType,
			"meta": service.SanitizeAuditMeta(e.Meta), "created_at": e.CreatedAt,
		}
		if e.ActorID != nil {
			item["actor_user_id"] = e.ActorID.String()
		}
		if e.EntityID != nil {
			item["entity_id"] = e.EntityID.String()
		}
		out = append(out, item)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out, "total": total, "limit": limit, "offset": offset})
}

func (a *API) ingestAudit(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ActorUserID string          `json:"actor_user_id"`
		Action      string          `json:"action"`
		EntityType  string          `json:"entity_type"`
		EntityID    *string         `json:"entity_id"`
		Meta        json.RawMessage `json:"meta"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	actor, err := uuid.Parse(req.ActorUserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid actor_user_id"))
		return
	}
	var entityID *uuid.UUID
	if req.EntityID != nil && strings.TrimSpace(*req.EntityID) != "" {
		id, err := uuid.Parse(*req.EntityID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid entity_id"))
			return
		}
		entityID = &id
	}
	if err := a.svc.IngestAudit(r.Context(), actor, req.Action, req.EntityType, entityID, req.Meta); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func adminUserDTO(u domain.User, detail bool) map[string]any {
	roles := u.Roles
	if roles == nil {
		roles = []string{}
	}
	m := map[string]any{
		"id": u.ID.String(), "email": u.Email, "display_name": u.DisplayName,
		"roles": roles, "status": u.Status, "created_at": u.CreatedAt,
	}
	if detail {
		m["city"] = u.City
		m["updated_at"] = u.UpdatedAt
	}
	return m
}
