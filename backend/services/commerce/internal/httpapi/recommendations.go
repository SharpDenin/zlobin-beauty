package httpapi

import (
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerRecommendationRoutes(mux *http.ServeMux, auth func(http.Handler) http.Handler) {
	mux.Handle("POST /v1/commerce/recommendations", auth(http.HandlerFunc(a.createRecommendation)))
	mux.Handle("GET /v1/commerce/recommendations/mine", auth(http.HandlerFunc(a.listMyRecommendations)))
	mux.Handle("DELETE /v1/commerce/recommendations/{id}", auth(http.HandlerFunc(a.deleteRecommendation)))
	mux.Handle("GET /v1/commerce/shop/recommendations", auth(http.HandlerFunc(a.listShopRecommendations)))
}

func (a *API) createRecommendation(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		ProductID    string     `json:"product_id"`
		ClientUserID *string    `json:"client_user_id"`
		Comment      string     `json:"comment"`
		ExpiresAt    *time.Time `json:"expires_at"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid json body"))
		return
	}
	productID, err := uuid.Parse(req.ProductID)
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid product_id"))
		return
	}
	var clientUserID *uuid.UUID
	if req.ClientUserID != nil && *req.ClientUserID != "" {
		id, err := uuid.Parse(*req.ClientUserID)
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid client_user_id"))
			return
		}
		clientUserID = &id
	}
	reco, err := a.svc.CreateRecommendation(r.Context(), service.CreateRecommendationInput{
		MasterUserID: claims.UserID, JWTRoles: claims.Roles,
		ProductID: productID, ClientUserID: clientUserID, Comment: req.Comment, ExpiresAt: req.ExpiresAt,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, recommendationDTO(*reco))
}

func (a *API) listMyRecommendations(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	items, err := a.svc.ListMyRecommendations(r.Context(), claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, recommendationDTO(item))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) deleteRecommendation(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	if err := a.svc.DeleteRecommendation(r.Context(), claims.UserID, id); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) listShopRecommendations(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	items, err := a.svc.ListShopRecommendations(r.Context(), claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		dto := recommendationDTO(item.ProductRecommendation)
		dto["product"] = shopProductDTO(item.Product)
		out = append(out, dto)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func recommendationDTO(r domain.ProductRecommendation) map[string]any {
	var clientUserID any
	if r.ClientUserID != nil {
		clientUserID = r.ClientUserID.String()
	}
	var expiresAt any
	if r.ExpiresAt != nil {
		expiresAt = *r.ExpiresAt
	}
	return map[string]any{
		"id": r.ID.String(), "master_user_id": r.MasterUserID.String(), "product_id": r.ProductID.String(),
		"client_user_id": clientUserID, "comment": r.Comment, "expires_at": expiresAt, "created_at": r.CreatedAt,
	}
}
