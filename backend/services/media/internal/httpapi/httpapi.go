package httpapi

import (
	"log/slog"
	"mime/multipart"
	"net/http"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/media/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/media/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

// multipartOverhead leaves room for boundaries and the small text fields around the file part.
const multipartOverhead = 1 << 20

type API struct {
	svc           *service.Service
	log           *slog.Logger
	internalToken string
}

func New(svc *service.Service, log *slog.Logger, internalToken string) *API {
	return &API{svc: svc, log: log, internalToken: internalToken}
}

func (a *API) Routes(mux *http.ServeMux, jwtSecret string) {
	auth := httpx.BearerAuth(jwtSecret)
	optional := httpx.OptionalBearerAuth(jwtSecret)
	internal := httpx.InternalAuth(a.internalToken)
	mux.Handle("POST /v1/media", auth(http.HandlerFunc(a.upload)))
	mux.Handle("GET /v1/media/{id}", optional(http.HandlerFunc(a.getMetadata)))
	mux.Handle("GET /v1/media/{id}/url", optional(http.HandlerFunc(a.signedURL)))
	mux.Handle("GET /v1/media/{id}/content", optional(http.HandlerFunc(a.getContent)))
	mux.Handle("HEAD /v1/media/{id}/content", optional(http.HandlerFunc(a.getContent)))
	mux.Handle("DELETE /v1/media/{id}", auth(http.HandlerFunc(a.delete)))
	mux.Handle("GET /v1/internal/media/{id}", internal(http.HandlerFunc(a.internalGet)))
}

func (a *API) upload(w http.ResponseWriter, r *http.Request) {
	claims, _ := httpx.ClaimsFrom(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, domain.MaxVideoUploadBytes+multipartOverhead)
	// Only 1 MiB stays in RAM; larger parts spill to a temp file and are streamed to object storage.
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		if httpx.IsBodyTooLarge(err) {
			httpx.WriteError(w, r, a.log, apperr.ValidationCode(apperr.CodeMediaTooLarge, "file exceeds size limit").
				WithDetails(map[string]any{"max_bytes": int64(domain.MaxVideoUploadBytes)}))
			return
		}
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid multipart form"))
		return
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()
	file, header, err := r.FormFile("file")
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.ValidationCode(apperr.CodeMediaEmpty, "file field is required"))
		return
	}
	defer func(f multipart.File) { _ = f.Close() }(file)

	result, err := a.svc.Upload(r.Context(), service.UploadInput{
		OwnerUserID:  claims.UserID,
		Purpose:      r.FormValue("purpose"),
		OriginalName: header.Filename,
		ContentType:  header.Header.Get("Content-Type"),
		Reader:       file,
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

// signedURL hands out a short-lived URL that <img>/<video> can load natively (with Range
// support) for media that is not public, without putting the bearer token into the page.
func (a *API) signedURL(w http.ResponseWriter, r *http.Request) {
	userID := uuid.Nil
	if claims, ok := httpx.ClaimsFrom(r.Context()); ok {
		userID = claims.UserID
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	path, expires, err := a.svc.SignedContentPath(r.Context(), id, userID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.JSON(w, http.StatusOK, map[string]any{"url": path, "expires_at": expires})
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
	q := r.URL.Query()
	if sig := q.Get("sig"); sig != "" {
		signedUser, ok := a.svc.VerifySignature(id, q.Get("u"), q.Get("exp"), sig)
		if !ok {
			httpx.WriteError(w, r, a.log, apperr.UnauthorizedCode(apperr.CodeSessionExpired, "media link expired"))
			return
		}
		userID = signedUser
	}
	content, err := a.svc.GetContent(r.Context(), id, userID)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	defer content.Reader.Close()
	obj := content.Object

	h := w.Header()
	h.Set("Content-Type", obj.ContentType)
	h.Set("Accept-Ranges", "bytes")
	h.Set("ETag", `"`+obj.SHA256+`"`)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	h.Set("Cross-Origin-Resource-Policy", "cross-origin")
	if domain.IsPublicPurpose(obj.Purpose) {
		h.Set("Cache-Control", "public, max-age=86400")
	} else {
		h.Set("Cache-Control", "private, max-age=300")
	}
	disposition := "inline"
	if obj.ContentType == "application/pdf" {
		disposition = "attachment"
	}
	h.Set("Content-Disposition", disposition+`; filename="`+downloadName(obj)+`"`)
	// ServeContent implements Range / If-None-Match / HEAD: required for iOS video playback.
	http.ServeContent(w, r, "", obj.CreatedAt, content.Reader)
}

func downloadName(obj *domain.MediaObject) string {
	name := "media-" + obj.ID.String()
	if ext := domain.ExtensionForContentType(obj.ContentType); ext != "" {
		name += ext
	}
	return name
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

func (a *API) internalGet(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, a.log, apperr.Validation("invalid id"))
		return
	}
	obj, err := a.svc.InternalGet(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, a.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"id": obj.ID.String(), "owner_user_id": obj.OwnerUserID.String(),
		"purpose": obj.Purpose, "content_type": obj.ContentType,
		"size_bytes": obj.SizeBytes, "created_at": obj.CreatedAt,
	})
}

func uploadDTO(r service.UploadResult) map[string]any {
	dto := map[string]any{
		"id": r.ID.String(), "purpose": r.Purpose, "content_type": r.ContentType,
		"size_bytes": r.SizeBytes, "sha256": r.SHA256, "created_at": r.CreatedAt,
	}
	if r.Width > 0 && r.Height > 0 {
		dto["width"] = r.Width
		dto["height"] = r.Height
	}
	return dto
}

func metadataDTO(m domain.MediaObject) map[string]any {
	return map[string]any{
		"id": m.ID.String(), "purpose": m.Purpose, "content_type": m.ContentType,
		"size_bytes": m.SizeBytes, "sha256": m.SHA256, "original_name": m.OriginalName,
		"created_at": m.CreatedAt,
	}
}