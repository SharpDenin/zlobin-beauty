package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/auth"
)

type ctxKey string

const (
	KeyRequestID ctxKey = "request_id"
	KeyClaims    ctxKey = "claims"
)

type ErrorBody struct {
	Error ErrorDetail `json:"error"`
}

type ErrorDetail struct {
	Code      string         `json:"code"`
	Message   string         `json:"message"`
	RequestID string         `json:"request_id"`
	Details   map[string]any `json:"details,omitempty"`
}

func RequestID(r *http.Request) string {
	if v, ok := r.Context().Value(KeyRequestID).(string); ok && v != "" {
		return v
	}
	return ""
}

func ClaimsFrom(ctx context.Context) (*auth.Claims, bool) {
	c, ok := ctx.Value(KeyClaims).(*auth.Claims)
	return c, ok
}

func WithRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = uuid.NewString()
		}
		w.Header().Set("X-Request-ID", id)
		ctx := context.WithValue(r.Context(), KeyRequestID, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func DecodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

func WriteError(w http.ResponseWriter, r *http.Request, log *slog.Logger, err error) {
	rid := RequestID(r)
	var ae *apperr.AppError
	if errors.As(err, &ae) {
		if log != nil {
			if ae.HTTPStatus >= 500 {
				log.Error("request failed", "error", ae.Err, "code", ae.Code, "request_id", rid)
			} else {
				log.Info("request error", "code", ae.Code, "status", ae.HTTPStatus, "message", ae.Message, "request_id", rid)
			}
		}
		JSON(w, ae.HTTPStatus, ErrorBody{Error: ErrorDetail{
			Code:      string(ae.Code),
			Message:   ae.Message,
			RequestID: rid,
			Details:   ae.Details,
		}})
		return
	}
	if log != nil {
		log.Error("unhandled error", "error", err, "request_id", rid)
	}
	JSON(w, http.StatusInternalServerError, ErrorBody{Error: ErrorDetail{Code: string(apperr.CodeInternal), Message: "internal error", RequestID: rid}})
}

func BearerAuth(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header.Get("Authorization")
			if !strings.HasPrefix(h, "Bearer ") {
				WriteError(w, r, nil, apperr.SessionExpired())
				return
			}
			claims, err := auth.ParseAccessToken(secret, strings.TrimPrefix(h, "Bearer "))
			if err != nil {
				WriteError(w, r, nil, apperr.SessionExpired())
				return
			}
			ctx := context.WithValue(r.Context(), KeyClaims, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// InternalAuth guards service-to-service endpoints with a shared secret
// token, checked against the X-Internal-Token header. If token is empty
// (not configured), all requests are rejected.
func InternalAuth(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if token == "" || r.Header.Get("X-Internal-Token") != token {
				WriteError(w, r, nil, apperr.Unauthorized("invalid internal token"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func OptionalBearerAuth(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header.Get("Authorization")
			if strings.HasPrefix(h, "Bearer ") {
				claims, err := auth.ParseAccessToken(secret, strings.TrimPrefix(h, "Bearer "))
				if err == nil {
					r = r.WithContext(context.WithValue(r.Context(), KeyClaims, claims))
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func CORS(origins []string) func(http.Handler) http.Handler {
	allowed := map[string]struct{}{}
	for _, o := range origins {
		allowed[o] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if _, ok := allowed[origin]; ok {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID, Idempotency-Key")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

func MaxBytes(n int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, n)
			next.ServeHTTP(w, r)
		})
	}
}

func AccessLog(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := &statusWriter{ResponseWriter: w, status: 200}
			next.ServeHTTP(ww, r)
			log.Info("http",
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.status,
				"duration_ms", time.Since(start).Milliseconds(),
				"request_id", RequestID(r),
			)
		})
	}
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func Healthz(w http.ResponseWriter, _ *http.Request) {
	JSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func Readyz(check func(context.Context) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := check(ctx); err != nil {
			JSON(w, http.StatusServiceUnavailable, map[string]string{"status": "not_ready"})
			return
		}
		JSON(w, http.StatusOK, map[string]string{"status": "ready"})
	}
}
