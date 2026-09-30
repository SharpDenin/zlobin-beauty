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
	mux.Handle("PATCH /v1/me/master/portfolio/{id}", auth(http.HandlerFunc(a.patchPortfolioItem)))
	mux.Handle("DELETE /v1/me/master/portfolio/{id}", auth(http.HandlerFunc(a.deletePortfolioItem)))
	mux.Handle("PUT /v1/me/master/portfolio/order", auth(http.HandlerFunc(a.reorderPortfolio)))
	mux.HandleFunc("GET /v1/masters/{id}/portfolio", a.masterPortfolio)
}

func (a *API) myPortfolio(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	category := r.URL.Query().Get("category")
	items, err := a.svc.ListMyPortfolio(r.Context(), claims.UserID, category)
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
		MediaID     string `json:"media_id"`
		Caption     string `json:"caption"`
		Title       string `json:"title"`
		Description string `json:"description"`
		Category    string `json:"category"`
		SortOrder   *int   `json:"sort_order"`
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
		UserID: claims.UserID, MediaID: mediaID, Caption: req.Caption,
		Title: req.Title, Description: req.Description, Category: req.Category, SortOrder: req.SortOrder,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, portfolioDTO(*item))
}

func (a *API) patchPortfolioItem(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	var req struct {
		MediaID     *string `json:"media_id"`
		Caption     *string `json:"caption"`
		Title       *string `json:"title"`
		Description *string `json:"description"`
		Category    *string `json:"category"`
		SortOrder   *int    `json:"sort_order"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	in := service.UpdatePortfolioInput{
		UserID: claims.UserID, ItemID: id,
		Caption: req.Caption, Title: req.Title, Description: req.Description,
		Category: req.Category, SortOrder: req.SortOrder,
	}
	if req.MediaID != nil {
		mediaID, err := uuid.Parse(*req.MediaID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid media_id"))
			return
		}
		in.MediaID = &mediaID
	}
	item, err := a.svc.UpdatePortfolioItem(r.Context(), in)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, portfolioDTO(*item))
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

func (a *API) reorderPortfolio(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		OrderedIDs []string `json:"ordered_ids"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	ids := make([]uuid.UUID, 0, len(req.OrderedIDs))
	for _, raw := range req.OrderedIDs {
		id, err := uuid.Parse(raw)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid ordered_ids"))
			return
		}
		ids = append(ids, id)
	}
	if err := a.svc.ReorderMyPortfolio(r.Context(), claims.UserID, ids); err != nil {
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
	category := r.URL.Query().Get("category")
	items, err := a.svc.ListMasterPortfolio(r.Context(), id, category)
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
	title := item.DisplayTitle()
	return map[string]any{
		"id": item.ID.String(), "master_id": item.MasterID.String(), "media_id": item.MediaID.String(),
		"caption": item.Caption, "title": title, "description": item.Description, "category": item.Category,
		"media_type": item.MediaType, "sort_order": item.SortOrder,
		"created_at": item.CreatedAt, "updated_at": item.UpdatedAt,
	}
}
