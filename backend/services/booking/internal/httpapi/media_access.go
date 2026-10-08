package httpapi

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

// internalMediaAccess is called by the media service (S2S) to authorize appointment photos.
func (a *API) internalMediaAccess(w http.ResponseWriter, r *http.Request) {
	if a.internalToken == "" || r.Header.Get("X-Internal-Token") != a.internalToken {
		httpx.WriteError(w, r, a.log, apperr.Unauthorized("invalid internal token"))
		return
	}
	mediaID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid media id"))
		return
	}
	userID, err := uuid.Parse(r.URL.Query().Get("user_id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("user_id is required"))
		return
	}
	allowed, err := a.svc.MediaVisibleToUser(r.Context(), mediaID, userID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"allowed": allowed})
}
