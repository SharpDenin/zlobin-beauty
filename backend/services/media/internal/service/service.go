package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"  // register decoders for header validation
	_ "image/jpeg" // register decoders for header validation
	_ "image/png"  // register decoders for header validation
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/media/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/media/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

const (
	signedURLTTL        = 15 * time.Minute
	uploadsPerMinute    = 40
	maxOriginalNameRune = 120
)

type Service struct {
	store             *store.Store
	storage           *ObjectStorage
	communicationsURL string
	bookingURL        string
	internalToken     string
	signingKey        []byte
	httpClient        *http.Client
	now               func() time.Time
	limiter           *uploadLimiter
}

func New(st *store.Store, storage *ObjectStorage) *Service {
	return &Service{
		store: st, storage: storage,
		httpClient: &http.Client{Timeout: 5 * time.Second},
		now:        time.Now,
		limiter:    newUploadLimiter(uploadsPerMinute, time.Minute),
	}
}

func (s *Service) WithCommunications(url, token string) *Service {
	s.communicationsURL = strings.TrimRight(url, "/")
	s.internalToken = token
	return s
}

// WithBooking enables appointment-scoped access checks for before/after photos.
func (s *Service) WithBooking(url string) *Service {
	s.bookingURL = strings.TrimRight(url, "/")
	return s
}

// WithSigningSecret enables short-lived signed content URLs (streamable <video>/<img> without headers).
func (s *Service) WithSigningSecret(secret string) *Service {
	if secret != "" {
		sum := sha256.Sum256([]byte("media-url|" + secret))
		s.signingKey = sum[:]
	}
	return s
}

type UploadInput struct {
	OwnerUserID  uuid.UUID
	Purpose      string
	OriginalName string
	ContentType  string
	Reader       io.ReadSeeker
}

type UploadResult struct {
	ID          uuid.UUID
	Purpose     string
	ContentType string
	SizeBytes   int64
	SHA256      string
	CreatedAt   time.Time
	Width       int
	Height      int
}

func sanitizeOriginalName(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	name = filepath.Base(strings.TrimSpace(name))
	if name == "." || name == "/" {
		return ""
	}
	var b strings.Builder
	n := 0
	for _, r := range name {
		if unicode.IsControl(r) || r == '"' || r == '<' || r == '>' {
			continue
		}
		b.WriteRune(r)
		n++
		if n >= maxOriginalNameRune {
			break
		}
	}
	return b.String()
}

func (s *Service) Upload(ctx context.Context, in UploadInput) (*UploadResult, error) {
	purpose := strings.TrimSpace(in.Purpose)
	if !domain.ValidPurpose(purpose) {
		return nil, apperr.Validation("invalid purpose")
	}
	if !s.limiter.allow(in.OwnerUserID.String()) {
		return nil, apperr.New(apperr.CodeMediaTooManyRequests, http.StatusTooManyRequests, "too many uploads")
	}

	// 1) Detect the REAL type from magic bytes; the declared MIME type is advisory only.
	head := make([]byte, 512)
	n, err := io.ReadFull(in.Reader, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return nil, apperr.Internal(err)
	}
	head = head[:n]
	if n == 0 {
		return nil, apperr.ValidationCode(apperr.CodeMediaEmpty, "empty file")
	}
	ct := domain.SniffContentType(head)
	if ct == "" {
		return nil, apperr.ValidationCode(apperr.CodeMediaUnsupportedType, "unsupported content type")
	}
	if !domain.DeclaredCompatible(in.ContentType, ct) {
		return nil, apperr.ValidationCode(apperr.CodeMediaInvalidContent, "file content does not match its type")
	}
	if !domain.ContentAllowedForPurpose(purpose, ct) {
		return nil, apperr.ValidationCode(apperr.CodeMediaUnsupportedType, "unsupported content type")
	}
	ext := domain.ExtensionForContentType(ct)
	if ext == "" {
		return nil, apperr.ValidationCode(apperr.CodeMediaUnsupportedType, "unsupported content type")
	}
	maxBytes := domain.MaxBytesForContentType(ct)

	// 2) Hash and measure with a hard cap (the body may be larger than declared).
	if _, err := in.Reader.Seek(0, io.SeekStart); err != nil {
		return nil, apperr.Internal(err)
	}
	hasher := sha256.New()
	written, err := io.Copy(hasher, io.LimitReader(in.Reader, maxBytes+1))
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if written > maxBytes {
		return nil, apperr.ValidationCode(apperr.CodeMediaTooLarge, "file exceeds size limit").
			WithDetails(map[string]any{"max_bytes": maxBytes})
	}
	if written == 0 {
		return nil, apperr.ValidationCode(apperr.CodeMediaEmpty, "empty file")
	}

	// 3) Images must actually decode (header) and stay within sane dimensions.
	var width, height int
	if ct == "image/jpeg" || ct == "image/png" || ct == "image/gif" {
		if _, err := in.Reader.Seek(0, io.SeekStart); err != nil {
			return nil, apperr.Internal(err)
		}
		cfg, _, derr := image.DecodeConfig(in.Reader)
		if derr != nil {
			return nil, apperr.ValidationCode(apperr.CodeMediaInvalidContent, "image is corrupted")
		}
		width, height = cfg.Width, cfg.Height
		if width <= 0 || height <= 0 || width > domain.MaxImageDimension || height > domain.MaxImageDimension || int64(width)*int64(height) > domain.MaxImagePixels {
			return nil, apperr.ValidationCode(apperr.CodeMediaTooLarge, "image dimensions are too large").
				WithDetails(map[string]any{"max_dimension": domain.MaxImageDimension})
		}
	}

	// 4) Store under a random key (never the client filename) and record metadata.
	if _, err := in.Reader.Seek(0, io.SeekStart); err != nil {
		return nil, apperr.Internal(err)
	}
	id := ids.New()
	objectKey := purpose + "/" + in.OwnerUserID.String() + "/" + id.String() + ext
	sha := hex.EncodeToString(hasher.Sum(nil))
	now := s.now().UTC()
	if err := s.storage.Put(ctx, objectKey, ct, written, in.Reader); err != nil {
		return nil, apperr.Internal(err)
	}
	obj := domain.MediaObject{
		ID: id, OwnerUserID: in.OwnerUserID, Purpose: purpose, ContentType: ct,
		SizeBytes: written, SHA256: sha, ObjectKey: objectKey, Bucket: s.storage.Bucket(),
		OriginalName: sanitizeOriginalName(in.OriginalName), CreatedAt: now,
	}
	if err := s.store.Insert(ctx, obj); err != nil {
		_ = s.storage.Delete(ctx, objectKey)
		return nil, apperr.Internal(err)
	}
	return &UploadResult{
		ID: id, Purpose: purpose, ContentType: ct, SizeBytes: written, SHA256: sha, CreatedAt: now,
		Width: width, Height: height,
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
	switch {
	case obj.Purpose == domain.PurposeMessage:
		ok, err := s.internalAccess(ctx, s.communicationsURL, obj.ID, userID)
		if err != nil {
			return err
		}
		if ok {
			return nil
		}
	case domain.IsAppointmentPurpose(obj.Purpose):
		ok, err := s.internalAccess(ctx, s.bookingURL, obj.ID, userID)
		if err != nil {
			return err
		}
		if ok {
			return nil
		}
	}
	return apperr.Forbidden("access denied")
}

// internalAccess asks the owning service whether userID may see the media (S2S, internal token).
func (s *Service) internalAccess(ctx context.Context, baseURL string, mediaID, userID uuid.UUID) (bool, error) {
	if baseURL == "" || s.internalToken == "" {
		return false, apperr.Forbidden("access denied")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		baseURL+"/v1/internal/media/"+mediaID.String()+"/access?user_id="+url.QueryEscape(userID.String()), nil)
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
	Object *domain.MediaObject
	Reader io.ReadSeekCloser
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
	return &ContentResult{Object: obj, Reader: rc}, nil
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

// --- signed content URLs -------------------------------------------------------------------

func (s *Service) sign(id, userID uuid.UUID, exp int64) string {
	mac := hmac.New(sha256.New, s.signingKey)
	_, _ = mac.Write([]byte(id.String() + "|" + userID.String() + "|" + strconv.FormatInt(exp, 10)))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// SignedContentPath returns a relative URL that authorizes reading one media object as userID for
// a short time. Access is verified now (so callers learn early) and again when the URL is used.
func (s *Service) SignedContentPath(ctx context.Context, id, userID uuid.UUID) (string, time.Time, error) {
	if len(s.signingKey) == 0 {
		return "", time.Time{}, apperr.Internal(fmt.Errorf("media url signing is not configured"))
	}
	if _, err := s.GetMetadata(ctx, id, userID); err != nil {
		return "", time.Time{}, err
	}
	expires := s.now().UTC().Add(signedURLTTL)
	exp := expires.Unix()
	q := url.Values{}
	q.Set("exp", strconv.FormatInt(exp, 10))
	q.Set("u", userID.String())
	q.Set("sig", s.sign(id, userID, exp))
	return "/v1/media/" + id.String() + "/content?" + q.Encode(), expires, nil
}

// VerifySignature authenticates a signed URL and returns the user it was issued for.
func (s *Service) VerifySignature(id uuid.UUID, rawUser, rawExp, sig string) (uuid.UUID, bool) {
	if len(s.signingKey) == 0 || rawUser == "" || rawExp == "" || sig == "" {
		return uuid.Nil, false
	}
	exp, err := strconv.ParseInt(rawExp, 10, 64)
	if err != nil || s.now().UTC().Unix() > exp {
		return uuid.Nil, false
	}
	userID, err := uuid.Parse(rawUser)
	if err != nil {
		return uuid.Nil, false
	}
	want := s.sign(id, userID, exp)
	if !hmac.Equal([]byte(want), []byte(sig)) {
		return uuid.Nil, false
	}
	return userID, true
}

// --- upload throttling ---------------------------------------------------------------------

type uploadLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	hits   map[string][]time.Time
}

func newUploadLimiter(limit int, window time.Duration) *uploadLimiter {
	return &uploadLimiter{limit: limit, window: window, hits: map[string][]time.Time{}}
}

func (l *uploadLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-l.window)
	recent := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}
	if len(recent) >= l.limit {
		l.hits[key] = recent
		return false
	}
	l.hits[key] = append(recent, now)
	if len(l.hits) > 10_000 { // bound memory: drop idle keys
		for k, v := range l.hits {
			if len(v) == 0 || v[len(v)-1].Before(cutoff) {
				delete(l.hits, k)
			}
		}
	}
	return true
}
