package httpapi

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerCloseRoutes(mux *http.ServeMux) {
	internal := httpx.InternalAuth(a.internalToken)
	mux.Handle("GET /v1/internal/branches/{branchID}/close-blockers", internal(http.HandlerFunc(a.internalBranchCloseBlockers)))
}

func (a *API) internalBranchCloseBlockers(w http.ResponseWriter, r *http.Request) {
	branchID, err := uuid.Parse(r.PathValue("branchID"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid branch id"))
		return
	}
	items, err := a.svc.BranchCloseBlockers(r.Context(), branchID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"blockers": items})
}
