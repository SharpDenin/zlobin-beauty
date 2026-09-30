package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
)

// Media limits must stay aligned with services/media/internal/domain (video ceiling + multipart overhead).
const (
	mediaUploadLimit  = 50<<20 + 2<<20
	defaultBodyLimit  = 1 << 20
	mediaUploadPath   = "/v1/media"
	maxTrackedClients = 50_000
)

var trustProxyHeaders = os.Getenv("TRUST_PROXY_HEADERS") == "true"

// clientIP is the address used for throttling and forwarded to services. X-Forwarded-For from the
// internet is ignored unless the gateway sits behind a trusted reverse proxy (TRUST_PROXY_HEADERS=true).
func clientIP(r *http.Request) string {
	if trustProxyHeaders {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			if first := strings.TrimSpace(strings.Split(xff, ",")[0]); net.ParseIP(first) != nil {
				return first
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func mustProxy(raw string) http.Handler {
	u, err := url.Parse(raw)
	if err != nil {
		panic(err)
	}
	p := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(u)
			pr.Out.Host = u.Host
			// Rewrite strips client-supplied X-Forwarded-*: set the single trusted value.
			pr.Out.Header.Set("X-Forwarded-For", clientIP(pr.In))
		},
		ModifyResponse: func(resp *http.Response) error {
			// Gateway owns browser CORS; drop upstream CORS to avoid duplicate ACAO.
			for _, h := range []string{
				"Access-Control-Allow-Origin", "Access-Control-Allow-Credentials", "Access-Control-Allow-Headers",
				"Access-Control-Allow-Methods", "Access-Control-Expose-Headers", "Access-Control-Max-Age",
			} {
				resp.Header.Del(h)
			}
			return nil
		},
		ErrorHandler: proxyError,
	}
	return p
}

// proxyError turns transport failures into the same JSON error envelope the services use, so the
// browser never receives an empty 502 body (which the UI could only show as "network error").
func proxyError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, context.Canceled):
		return // the client went away; nothing to tell
	case httpx.IsBodyTooLarge(err):
		httpx.WriteError(w, r, nil, tooLarge(r))
	case errors.Is(err, context.DeadlineExceeded), isTimeout(err):
		httpx.JSON(w, http.StatusGatewayTimeout, httpx.ErrorBody{Error: httpx.ErrorDetail{
			Code: "upstream_timeout", Message: "upstream timed out", RequestID: httpx.RequestID(r)}})
	default:
		httpx.JSON(w, http.StatusBadGateway, httpx.ErrorBody{Error: httpx.ErrorDetail{
			Code: "upstream_unavailable", Message: "service temporarily unavailable", RequestID: httpx.RequestID(r)}})
	}
}

func isTimeout(err error) bool {
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

func isMediaUpload(r *http.Request) bool {
	return r.Method == http.MethodPost && r.URL.Path == mediaUploadPath
}

func tooLarge(r *http.Request) *apperr.AppError {
	if isMediaUpload(r) {
		return apperr.ValidationCode(apperr.CodeMediaTooLarge, "file exceeds size limit").
			WithDetails(map[string]any{"max_bytes": int64(50 << 20)})
	}
	e := apperr.New(apperr.CodeValidation, http.StatusRequestEntityTooLarge, "request body is too large")
	return e
}

// bodyLimit caps request bodies. Oversized uploads are rejected up front from Content-Length with a
// typed 413 instead of half-proxying the body and surfacing a 502.
func bodyLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		limit := int64(defaultBodyLimit)
		if isMediaUpload(r) {
			limit = mediaUploadLimit
		}
		if r.ContentLength > limit {
			httpx.WriteError(w, r, nil, tooLarge(r))
			_ = r.Body.Close()
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit)
		next.ServeHTTP(w, r)
	})
}

// edgeDeadlines replaces the fixed server timeouts: uploads and media streaming get minutes,
// everything else stays tight.
func edgeDeadlines(r *http.Request) (read, write time.Duration, ok bool) {
	switch {
	case isMediaUpload(r):
		return 10 * time.Minute, 10 * time.Minute, true
	case strings.HasPrefix(r.URL.Path, "/v1/media/") && (strings.HasSuffix(r.URL.Path, "/content")):
		return 30 * time.Second, 30 * time.Minute, true
	}
	return 0, 0, false
}

// --- rate limiting --------------------------------------------------------------------------

type rateRule struct {
	match  func(*http.Request) bool
	name   string
	limit  int
	window time.Duration
}

type hitLog struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

func newHitLog() *hitLog { return &hitLog{hits: map[string][]time.Time{}} }

func (h *hitLog) allow(key string, limit int, window time.Duration) (bool, time.Duration) {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-window)
	recent := h.hits[key][:0]
	for _, t := range h.hits[key] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}
	if len(recent) >= limit {
		h.hits[key] = recent
		return false, recent[0].Add(window).Sub(now)
	}
	h.hits[key] = append(recent, now)
	if len(h.hits) > maxTrackedClients {
		for k, v := range h.hits {
			if len(v) == 0 || v[len(v)-1].Before(cutoff) {
				delete(h.hits, k)
			}
		}
	}
	return true, 0
}

func envLimit(name string, production, other int) int {
	if v := os.Getenv(name); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	if os.Getenv("APP_ENV") == "production" {
		return production
	}
	return other
}

// rateLimit throttles per client IP. Auth endpoints are tight in production (credential stuffing,
// registration abuse); non-production stacks (demo, e2e) get a much larger budget.
func rateLimit() func(http.Handler) http.Handler {
	rules := []rateRule{
		{name: "auth-login", limit: envLimit("RATE_LIMIT_LOGIN_PER_MIN", 20, 1200), window: time.Minute,
			match: func(r *http.Request) bool { return r.Method == http.MethodPost && r.URL.Path == "/v1/auth/login" }},
		{name: "auth-register", limit: envLimit("RATE_LIMIT_REGISTER_PER_MIN", 10, 1200), window: time.Minute,
			match: func(r *http.Request) bool { return r.Method == http.MethodPost && r.URL.Path == "/v1/auth/register" }},
		{name: "auth-refresh", limit: envLimit("RATE_LIMIT_REFRESH_PER_MIN", 120, 2400), window: time.Minute,
			match: func(r *http.Request) bool { return r.Method == http.MethodPost && r.URL.Path == "/v1/auth/refresh" }},
		{name: "media-upload", limit: envLimit("RATE_LIMIT_UPLOAD_PER_MIN", 60, 1200), window: time.Minute,
			match: isMediaUpload},
		{name: "global", limit: envLimit("RATE_LIMIT_GLOBAL_PER_MIN", 3000, 60000), window: time.Minute,
			match: func(r *http.Request) bool { return r.URL.Path != "/healthz" && r.URL.Path != "/readyz" }},
	}
	logs := map[string]*hitLog{}
	for _, rule := range rules {
		logs[rule.name] = newHitLog()
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodOptions {
				ip := clientIP(r)
				for _, rule := range rules {
					if !rule.match(r) {
						continue
					}
					if ok, retry := logs[rule.name].allow(ip, rule.limit, rule.window); !ok {
						w.Header().Set("Retry-After", strconv.Itoa(int(retry.Seconds())+1))
						httpx.WriteError(w, r, nil, apperr.RateLimited("too many requests"))
						return
					}
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// recoverPanics keeps a handler panic from dropping the connection without a JSON answer.
func recoverPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				if rec == http.ErrAbortHandler {
					panic(rec)
				}
				httpx.WriteError(w, r, nil, apperr.Internal(errors.New("panic in gateway handler")))
			}
		}()
		next.ServeHTTP(w, r)
	})
}
