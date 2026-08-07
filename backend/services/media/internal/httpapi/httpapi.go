package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/media/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/media/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

type API struct {
	svc *service.Service
	log *slog.Logger
}

func New(svc *service.Service, log *slog.Logger) *API { return &API{svc: svc, log: log} }

func (a *API) Routes(mux *http.ServeMux, jwtSecret string) {
	auth := httpx.BearerAuth(jwtSecret)
	optional := httpx.OptionalBearerAuth(jwtSecret)
	mux.Handle("POST /v1/media", auth(http.HandlerFunc(a.upload)))
	mux.Handle("GET /v1/media/{id}", optional(http.HandlerFunc(a.getMetadata)))
	mux.Handle("GET /v1/media/{id}/content", optional(http.HandlerFunc(a.getContent)))
	mux.Handle("DELETE /v1/media/{id}", auth(http.HandlerFunc(a.delete)))
}

func (a *API) upload(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	if err := r.ParseMultipartForm(6 << 20); err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid multipart form"))
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("file field is required"))
		return
	}
	defer file.Close()

	purpose := r.FormValue("purpose")
	ct := header.Header.Get("Content-Type")
	result, err := a.svc.Upload(r.Context(), service.UploadInput{
		OwnerUserID: claims.UserID, Purpose: purpose, OriginalName: header.Filename,
		ContentType: ct, Reader: file,
	})
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, uploadDTO(*result))
}

func (a *API) getMetadata(w http.ResponseWriter, r *http.Request) {
	userID := uuid.Nil
	if claims, ok := httpx.ClaimsFrom(r.Context()); ok {
		userID = claims.UserID
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	obj, err := a.svc.GetMetadata(r.Context(), id, userID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, metadataDTO(*obj))
}

func (a *API) getContent(w http.ResponseWriter, r *http.Request) {
	userID := uuid.Nil
	if claims, ok := httpx.ClaimsFrom(r.Context()); ok {
		userID = claims.UserID
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	content, err := a.svc.GetContent(r.Context(), id, userID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	defer content.Reader.Close()
	w.Header().Set("Content-Type", content.ContentType)
	w.Header().Set("Content-Length", strconv.FormatInt(content.SizeBytes, 10))
	w.WriteHeader(http.StatusOK)
	if _, err := io.Copy(w, content.Reader); err != nil {
		a.log.Error("stream content", "error", err)
	}
}

func (a *API) delete(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	if err := a.svc.Delete(r.Context(), id, claims.UserID); err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func uploadDTO(r service.UploadResult) map[string]any {
	return map[string]any{
		"id": r.ID.String(), "purpose": r.Purpose, "content_type": r.ContentType,
		"size_bytes": r.SizeBytes, "sha256": r.SHA256, "created_at": r.CreatedAt,
	}
}

func metadataDTO(m domain.MediaObject) map[string]any {
	return map[string]any{
		"id": m.ID.String(), "purpose": m.Purpose, "content_type": m.ContentType,
		"size_bytes": m.SizeBytes, "sha256": m.SHA256, "original_name": m.OriginalName,
		"created_at": m.CreatedAt,
	}
}
