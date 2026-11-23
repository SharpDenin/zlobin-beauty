package httpapi

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerCloseRoutes(mux *http.ServeMux) {
	internal := httpx.InternalAuth(a.internalToken)
	mux.Handle("GET /v1/internal/branches/{branchID}/masters", internal(http.HandlerFunc(a.internalMastersByBranch)))
	mux.Handle("POST /v1/internal/branches/{branchID}/close", internal(http.HandlerFunc(a.internalBranchClose)))
	mux.Handle("POST /v1/internal/branches/{branchID}/cancel-occurrences", internal(http.HandlerFunc(a.internalCancelOccurrences)))
}

func (a *API) internalMastersByBranch(w http.ResponseWriter, r *http.Request) {
	branchID, err := uuid.Parse(r.PathValue("branchID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid branch id"))
		return
	}
	items, err := a.svc.ListMastersByBranch(r.Context(), branchID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, m := range items {
		out = append(out, map[string]any{
			"user_id": m.UserID.String(), "id": m.ID.String(),
		})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) internalBranchClose(w http.ResponseWriter, r *http.Request) {
	branchID, err := uuid.Parse(r.PathValue("branchID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid branch id"))
		return
	}
	var req struct {
		OrganizationID       string   `json:"organization_id"`
		PrivateMasterUserIDs []string `json:"private_master_user_ids"`
		UnlinkMasterUserIDs  []string `json:"unlink_master_user_ids"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	orgID, _ := uuid.Parse(req.OrganizationID)
	in := service.BranchCloseInput{OrganizationID: orgID}
	for _, id := range req.PrivateMasterUserIDs {
		if u, err := uuid.Parse(id); err == nil {
			in.PrivateMasterUserIDs = append(in.PrivateMasterUserIDs, u)
		}
	}
	for _, id := range req.UnlinkMasterUserIDs {
		if u, err := uuid.Parse(id); err == nil {
			in.UnlinkMasterUserIDs = append(in.UnlinkMasterUserIDs, u)
		}
	}
	out, err := a.svc.CloseBranch(r.Context(), branchID, in)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *API) internalCancelOccurrences(w http.ResponseWriter, r *http.Request) {
	branchID, err := uuid.Parse(r.PathValue("branchID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid branch id"))
		return
	}
	n, err := a.svc.CancelOccurrencesByBranch(r.Context(), branchID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"cancelled": n})
}
