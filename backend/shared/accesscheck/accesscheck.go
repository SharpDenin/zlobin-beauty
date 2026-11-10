// Package accesscheck validates that an access JWT still maps to an active
// session and an active user. Identity is the source of truth; other processes
// call the internal validate endpoint with a short negative/positive cache.
package accesscheck

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/auth"
)

// Gate decides whether parsed access claims may proceed.
type Gate interface {
	Check(ctx context.Context, claims *auth.Claims) error
}

// ValidatorFunc adapts a function to Gate.
type ValidatorFunc func(ctx context.Context, claims *auth.Claims) error

func (f ValidatorFunc) Check(ctx context.Context, claims *auth.Claims) error {
	return f(ctx, claims)
}

type cacheEntry struct {
	ok      bool
	errCode apperr.Code
	until   time.Time
}

// HTTPGate calls identity's internal access validation API.
type HTTPGate struct {
	baseURL       string
	internalToken string
	client        *http.Client
	positiveTTL   time.Duration
	negativeTTL   time.Duration
	mu            sync.Mutex
	cache         map[string]cacheEntry
	now           func() time.Time
}

type HTTPGateOption func(*HTTPGate)

func WithPositiveTTL(d time.Duration) HTTPGateOption {
	return func(g *HTTPGate) { g.positiveTTL = d }
}

func WithNegativeTTL(d time.Duration) HTTPGateOption {
	return func(g *HTTPGate) { g.negativeTTL = d }
}

func WithHTTPClient(c *http.Client) HTTPGateOption {
	return func(g *HTTPGate) { g.client = c }
}

// NewHTTPGate builds a cached gate. positiveTTL should stay short so revoke/delete
// takes effect quickly; zero disables positive caching (strongest consistency).
func NewHTTPGate(identityURL, internalToken string, opts ...HTTPGateOption) *HTTPGate {
	g := &HTTPGate{
		baseURL:       trimRightSlash(identityURL),
		internalToken: internalToken,
		client:        &http.Client{Timeout: 3 * time.Second},
		// Default: no positive cache so revoke/delete is visible on the next request.
		// Negative answers are cached to avoid hammering identity after logout/block.
		positiveTTL: 0,
		negativeTTL: 30 * time.Second,
		cache:       map[string]cacheEntry{},
		now:         time.Now,
	}
	for _, opt := range opts {
		opt(g)
	}
	return g
}

func trimRightSlash(s string) string {
	for len(s) > 0 && s[len(s)-1] == '/' {
		s = s[:len(s)-1]
	}
	return s
}

func cacheKey(claims *auth.Claims) string {
	return claims.SessionID.String() + ":" + claims.UserID.String()
}

func (g *HTTPGate) Check(ctx context.Context, claims *auth.Claims) error {
	if claims == nil || claims.UserID == uuid.Nil || claims.SessionID == uuid.Nil {
		return apperr.SessionInvalid()
	}
	if g.baseURL == "" || g.internalToken == "" {
		// Misconfiguration must not fail open for protected traffic.
		return apperr.Unauthorized("access validation unavailable")
	}
	key := cacheKey(claims)
	now := g.now()
	g.mu.Lock()
	if e, ok := g.cache[key]; ok && now.Before(e.until) {
		g.mu.Unlock()
		if e.ok {
			return nil
		}
		return denyFromCode(e.errCode)
	}
	g.mu.Unlock()

	ok, code, err := g.fetch(ctx, claims)
	if err != nil {
		return err
	}
	ttl := g.negativeTTL
	if ok {
		ttl = g.positiveTTL
	}
	if ttl > 0 {
		g.mu.Lock()
		g.cache[key] = cacheEntry{ok: ok, errCode: code, until: now.Add(ttl)}
		g.mu.Unlock()
	}
	if ok {
		return nil
	}
	return denyFromCode(code)
}

// Invalidate drops cached allow/deny for a session (tests / local hooks).
func (g *HTTPGate) Invalidate(sessionID, userID uuid.UUID) {
	g.mu.Lock()
	delete(g.cache, sessionID.String()+":"+userID.String())
	g.mu.Unlock()
}

type validateReq struct {
	SessionID string `json:"session_id"`
	UserID    string `json:"user_id"`
}

type validateResp struct {
	Active bool   `json:"active"`
	Reason string `json:"reason,omitempty"`
}

func (g *HTTPGate) fetch(ctx context.Context, claims *auth.Claims) (bool, apperr.Code, error) {
	body, _ := json.Marshal(validateReq{
		SessionID: claims.SessionID.String(),
		UserID:    claims.UserID.String(),
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.baseURL+"/v1/internal/auth/validate-access", bytes.NewReader(body))
	if err != nil {
		return false, "", apperr.Internal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", g.internalToken)
	resp, err := g.client.Do(req)
	if err != nil {
		return false, "", apperr.Unauthorized("access validation unavailable")
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return false, "", apperr.Unauthorized("access validation unavailable")
	}
	var out validateResp
	if err := json.Unmarshal(raw, &out); err != nil {
		return false, "", apperr.Internal(fmt.Errorf("validate-access decode: %w", err))
	}
	if out.Active {
		return true, "", nil
	}
	return false, reasonToCode(out.Reason), nil
}

func reasonToCode(reason string) apperr.Code {
	switch reason {
	case "account_blocked", "account_deleted", "account_unavailable":
		return apperr.CodeAccountBlocked
	case "session_revoked", "session_expired", "session_missing", "user_mismatch":
		return apperr.CodeSessionInvalid
	default:
		return apperr.CodeSessionInvalid
	}
}

func denyFromCode(code apperr.Code) error {
	switch code {
	case apperr.CodeAccountBlocked:
		return apperr.AccountBlocked()
	case apperr.CodeSessionExpired:
		return apperr.SessionExpired()
	default:
		return apperr.SessionInvalid()
	}
}
