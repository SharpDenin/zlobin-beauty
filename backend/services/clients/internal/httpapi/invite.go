package httpapi

import (
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

func (a *API) registerInviteRoutes(mux *http.ServeMux, auth func(http.Handler) http.Handler) {
	mux.Handle("POST /v1/clients/invites", auth(http.HandlerFunc(a.createClientInvite)))
	mux.Handle("GET /v1/clients/invites", auth(http.HandlerFunc(a.listClientInvites)))
	mux.Handle("POST /v1/clients/invites/{id}/revoke", auth(http.HandlerFunc(a.revokeClientInvite)))
	mux.HandleFunc("GET /v1/clients/invite/{token}", a.peekClientInvite)
	mux.Handle("POST /v1/clients/invite/{token}/accept", auth(http.HandlerFunc(a.acceptClientInvite)))
}

func (a *API) createClientInvite(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	isMaster := false
	for _, role := range claims.Roles {
		if role == "master" {
			isMaster = true
			break
		}
	}
	if !isMaster {
		httpx.WriteError(w, r, a.log, apperr.Forbidden("master role required"))
		return
	}
	var req struct {
		OrganizationID string `json:"organization_id"`
		Hours          int    `json:"hours"`
		MaxUses        int    `json:"max_uses"`
	}
	_ = httpx.DecodeJSON(r, &req)
	var orgID *uuid.UUID
	if strings.TrimSpace(req.OrganizationID) != "" {
		id, err := uuid.Parse(strings.TrimSpace(req.OrganizationID))
		if err != nil {
			httpx.WriteError(w, r, a.log, apperr.Validation("invalid organization_id"))
			return
		}
		orgID = &id
	}
	ttl := time.Duration(req.Hours) * time.Hour
	created, err := a.svc.CreateClientInvite(r.Context(), claims.UserID, orgID, ttl, req.MaxUses)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	url := publicAppOrigin(r) + "/invite/client/" + created.Token
	httpx.JSON(w, http.StatusCreated, map[string]any{
		"id":         created.Invite.ID.String(),
		"token":      created.Token,
		"url":        url,
		"expires_at": created.Invite.ExpiresAt,
		"max_uses":   created.Invite.MaxUses,
	})
}

// publicAppOrigin mirrors organizations invite URL resolution:
// PUBLIC_APP_URL → Origin → X-Forwarded-Host → request host.
func publicAppOrigin(r *http.Request) string {
	if v := strings.TrimRight(strings.TrimSpace(os.Getenv("PUBLIC_APP_URL")), "/"); v != "" {
		return v
	}
	if v := strings.TrimRight(strings.TrimSpace(r.Header.Get("Origin")), "/"); v != "" {
		return v
	}
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	host := strings.TrimSpace(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = r.Host
	}
	if i := strings.IndexByte(host, ','); i >= 0 {
		host = strings.TrimSpace(host[:i])
	}
	if host == "" {
		host = "localhost"
	}
	return scheme + "://" + host
}

func (a *API) listClientInvites(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	items, err := a.svc.ListClientInvites(r.Context(), claims.UserID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, inv := range items {
		row := map[string]any{
			"id":         inv.ID.String(),
			"expires_at": inv.ExpiresAt,
			"max_uses":   inv.MaxUses,
			"use_count":  inv.UseCount,
			"created_at": inv.CreatedAt,
		}
		if inv.OrganizationID != nil {
			row["organization_id"] = inv.OrganizationID.String()
		}
		if inv.RevokedAt != nil {
			row["revoked_at"] = inv.RevokedAt
		}
		out = append(out, row)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *API) revokeClientInvite(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid invite id"))
		return
	}
	if err := a.svc.RevokeClientInvite(r.Context(), claims.UserID, id); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) peekClientInvite(w http.ResponseWriter, r *http.Request) {
	peek, err := a.svc.PeekClientInvite(r.Context(), r.PathValue("token"))
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, peek)
}

func (a *API) acceptClientInvite(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	var req struct {
		DisplayName string  `json:"display_name"`
		Phone       *string `json:"phone"`
		Email       *string `json:"email"`
	}
	_ = httpx.DecodeJSON(r, &req)
	name := strings.TrimSpace(req.DisplayName)
	if name == "" {
		name = "Клиент"
	}
	out, err := a.svc.AcceptClientInvite(r.Context(), r.PathValue("token"), claims.UserID, name, req.Phone, req.Email)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}
