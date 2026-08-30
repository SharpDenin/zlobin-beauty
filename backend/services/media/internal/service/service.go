package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/media/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/media/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type Service struct {
	store             *store.Store
	storage           *ObjectStorage
	communicationsURL string
	internalToken     string
	httpClient        *http.Client
	now               func() time.Time
}

func New(st *store.Store, storage *ObjectStorage) *Service {
	return &Service{store: st, storage: storage, httpClient: &http.Client{Timeout: 5 * time.Second}, now: time.Now}
}

func (s *Service) WithCommunications(url, token string) *Service {
	s.communicationsURL = strings.TrimRight(url, "/")
	s.internalToken = token
	return s
}

type UploadInput struct {
	OwnerUserID  uuid.UUID
	Purpose      string
	OriginalName string
	ContentType  string
	Reader       io.Reader
	SizeHint     int64
}

type UploadResult struct {
	ID          uuid.UUID
	Purpose     string
	ContentType string
	SizeBytes   int64
	SHA256      string
	CreatedAt   time.Time
}

func (s *Service) Upload(ctx context.Context, in UploadInput) (*UploadResult, error) {
	purpose := strings.TrimSpace(in.Purpose)
	if !domain.ValidPurpose(purpose) {
		return nil, apperr.Validation("invalid purpose")
	}
	maxBytes := domain.MaxBytesForPurpose(purpose)
	limitReader := io.LimitReader(in.Reader, maxBytes+1)
	head := make([]byte, 512)
	n, err := io.ReadFull(limitReader, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return nil, apperr.Internal(err)
	}
	ct := strings.TrimSpace(strings.ToLower(in.ContentType))
	if ct == "" || ct == "application/octet-stream" {
		ct = http.DetectContentType(head[:n])
	}
	if !domain.ValidContentType(ct) {
		return nil, apperr.ValidationCode(apperr.CodeMediaUnsupportedType, "unsupported content type")
	}
	if !domain.ContentAllowedForPurpose(purpose, ct) {
		return nil, apperr.ValidationCode(apperr.CodeMediaUnsupportedType, "unsupported content type")
	}
	if strings.HasPrefix(ct, "video/") && !domain.AllowsVideo(purpose) {
		return nil, apperr.Validation("video uploads require purpose=video")
	}
	ext := domain.ExtensionForContentType(ct)
	if ext == "" {
		return nil, apperr.ValidationCode(apperr.CodeMediaUnsupportedType, "unsupported content type")
	}

	combined := io.MultiReader(bytes.NewReader(head[:n]), limitReader)
	var buf bytes.Buffer
	hasher := sha256.New()
	written, err := io.Copy(io.MultiWriter(&buf, hasher), combined)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if written > maxBytes {
		return nil, apperr.ValidationCode(apperr.CodeMediaTooLarge, "file exceeds size limit")
	}
	if strings.HasPrefix(ct, "image/") && written > domain.MaxUploadBytes {
		return nil, apperr.ValidationCode(apperr.CodeMediaTooLarge, "file exceeds size limit")
	}
	if written == 0 {
		return nil, apperr.ValidationCode(apperr.CodeMediaEmpty, "empty file")
	}

	id := ids.New()
	objectKey := purpose + "/" + in.OwnerUserID.String() + "/" + id.String() + ext
	sha := hex.EncodeToString(hasher.Sum(nil))
	now := s.now().UTC()

	if err := s.storage.Put(ctx, objectKey, ct, written, bytes.NewReader(buf.Bytes())); err != nil {
		return nil, apperr.Internal(err)
	}

	obj := domain.MediaObject{
		ID: id, OwnerUserID: in.OwnerUserID, Purpose: purpose, ContentType: ct,
		SizeBytes: written, SHA256: sha, ObjectKey: objectKey, Bucket: s.storage.Bucket(),
		OriginalName: strings.TrimSpace(in.OriginalName), CreatedAt: now,
	}
	if err := s.store.Insert(ctx, obj); err != nil {
		_ = s.storage.Delete(ctx, objectKey)
		return nil, apperr.Internal(err)
	}
	return &UploadResult{
		ID: id, Purpose: purpose, ContentType: ct, SizeBytes: written, SHA256: sha, CreatedAt: now,
	}, nil
}

func (s *Service) GetMetadata(ctx context.Context, id, userID uuid.UUID) (*domain.MediaObject, error) {
	obj, err := s.store.Get(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if obj == nil {
		return nil, apperr.NotFound("media not found")
	}
	if err := s.checkMediaAccess(ctx, obj, userID); err != nil {
		return nil, err
	}
	return obj, nil
}

func (s *Service) InternalGet(ctx context.Context, id uuid.UUID) (*domain.MediaObject, error) {
	obj, err := s.store.Get(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if obj == nil {
		return nil, apperr.NotFound("media not found")
	}
	return obj, nil
}

func (s *Service) checkMediaAccess(ctx context.Context, obj *domain.MediaObject, userID uuid.UUID) error {
	if domain.IsPublicPurpose(obj.Purpose) {
		return nil
	}
	if userID == uuid.Nil {
		return apperr.Unauthorized("authentication required")
	}
	if obj.OwnerUserID == userID {
		return nil
	}
	if domain.IsSharedPurpose(obj.Purpose) {
		return nil
	}
	if obj.Purpose == domain.PurposeMessage {
		ok, err := s.messageMediaAllowed(ctx, obj.ID, userID)
		if err != nil {
			return err
		}
		if ok {
			return nil
		}
	}
	return apperr.Forbidden("access denied")
}

func (s *Service) messageMediaAllowed(ctx context.Context, mediaID, userID uuid.UUID) (bool, error) {
	if s.communicationsURL == "" || s.internalToken == "" {
		return false, apperr.Forbidden("access denied")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		s.communicationsURL+"/v1/internal/media/"+mediaID.String()+"/access?user_id="+userID.String(), nil)
	if err != nil {
		return false, apperr.Internal(err)
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return false, apperr.Internal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return false, apperr.Forbidden("access denied")
	}
	var body struct {
		Allowed bool `json:"allowed"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&body); err != nil {
		return false, apperr.Internal(err)
	}
	return body.Allowed, nil
}

type ContentResult struct {
	ContentType string
	SizeBytes   int64
	Reader      io.ReadCloser
}

func (s *Service) GetContent(ctx context.Context, id, userID uuid.UUID) (*ContentResult, error) {
	obj, err := s.GetMetadata(ctx, id, userID)
	if err != nil {
		return nil, err
	}
	rc, err := s.storage.Get(ctx, obj.ObjectKey)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return &ContentResult{ContentType: obj.ContentType, SizeBytes: obj.SizeBytes, Reader: rc}, nil
}

func (s *Service) Delete(ctx context.Context, id, userID uuid.UUID) error {
	obj, err := s.store.Get(ctx, id)
	if err != nil {
		return apperr.Internal(err)
	}
	if obj == nil {
		return apperr.NotFound("media not found")
	}
	if obj.OwnerUserID != userID {
		return apperr.Forbidden("access denied")
	}
	if err := s.storage.Delete(ctx, obj.ObjectKey); err != nil {
		return apperr.Internal(err)
	}
	if err := s.store.Delete(ctx, id); err != nil {
		return apperr.Internal(err)
	}
	return nil
}
