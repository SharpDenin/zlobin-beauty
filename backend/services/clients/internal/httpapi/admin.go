package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerAdminRoutes(mux *http.ServeMux, auth func(http.Handler) http.Handler) {
	admin := func(h http.HandlerFunc) http.Handler {
		return auth(httpx.RequireSystemAdmin(h))
	}
	mux.Handle("GET /v1/admin/disputes", admin(a.adminListDisputes))
	mux.Handle("GET /v1/admin/disputes/stats", admin(a.adminDisputeStats))
	mux.Handle("GET /v1/admin/disputes/{id}", admin(a.adminGetDispute))
	mux.Handle("POST /v1/admin/disputes/{id}/resolve", admin(a.adminResolveDispute))
}

func (a *API) adminDisputeStats(w http.ResponseWriter, r *http.Request) {
	open, total, err := a.svc.AdminDisputeStats(r.Context())
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"disputes_open": open, "disputes_total": total})
}

func (a *API) adminListDisputes(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, offset := httpx.ParsePage(q.Get("limit"), q.Get("offset"))
	items, total, err := a.svc.AdminListDisputes(r.Context(), q.Get("status"), limit, offset)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, d := range items {
		out = append(out, disputeDTO(d))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out, "total": total, "limit": limit, "offset": offset})
}

func (a *API) adminGetDispute(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	detail, err := a.svc.AdminGetDispute(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	body := disputeDTO(detail.Dispute)
	if detail.Card != nil {
		body["card"] = map[string]any{
			"id": detail.Card.ID.String(), "user_id": detail.Card.UserID.String(),
			"organization_id": detail.Card.OrganizationID.String(), "display_name": detail.Card.DisplayName,
		}
	}
	events := make([]map[string]any, 0, len(detail.Events))
	for _, ev := range detail.Events {
		events = append(events, map[string]any{
			"id": ev.ID.String(), "actor_user_id": ev.ActorUserID.String(), "action": ev.Action,
			"from_status": ev.FromStatus, "to_status": ev.ToStatus, "created_at": ev.CreatedAt,
		})
	}
	body["events"] = events
	httpx.JSON(w, http.StatusOK, body)
}

func (a *API) adminResolveDispute(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		Status string `json:"status"`
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	d, err := a.svc.ResolveDisputeAsPlatform(r.Context(), id, claims.UserID, req.Status, req.Reason)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, disputeDTO(*d))
}
