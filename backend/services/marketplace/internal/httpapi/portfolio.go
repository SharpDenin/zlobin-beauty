package httpapi

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerPortfolioRoutes(mux *http.ServeMux, auth func(http.Handler) http.Handler) {
	mux.Handle("GET /v1/me/master/portfolio", auth(http.HandlerFunc(a.myPortfolio)))
	mux.Handle("POST /v1/me/master/portfolio", auth(http.HandlerFunc(a.addPortfolioItem)))
	mux.Handle("DELETE /v1/me/master/portfolio/{id}", auth(http.HandlerFunc(a.deletePortfolioItem)))
	mux.HandleFunc("GET /v1/masters/{id}/portfolio", a.masterPortfolio)
}

func (a *API) myPortfolio(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	items, err := a.svc.ListMyPortfolio(r.Context(), claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, portfolioDTO(item))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) addPortfolioItem(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		MediaID   string `json:"media_id"`
		Caption   string `json:"caption"`
		SortOrder int    `json:"sort_order"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	mediaID, err := uuid.Parse(req.MediaID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid media_id"))
		return
	}
	item, err := a.svc.AddPortfolioItem(r.Context(), service.AddPortfolioInput{
		UserID: claims.UserID, MediaID: mediaID, Caption: req.Caption, SortOrder: req.SortOrder,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, portfolioDTO(*item))
}

func (a *API) deletePortfolioItem(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	if err := a.svc.DeletePortfolioItem(r.Context(), claims.UserID, id); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) masterPortfolio(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	items, err := a.svc.ListMasterPortfolio(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, portfolioDTO(item))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func portfolioDTO(item domain.PortfolioItem) map[string]any {
	return map[string]any{
		"id": item.ID.String(), "master_id": item.MasterID.String(), "media_id": item.MediaID.String(),
		"caption": item.Caption, "sort_order": item.SortOrder, "created_at": item.CreatedAt,
	}
}
