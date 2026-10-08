package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func errorCode(t *testing.T, body io.Reader) string {
	t.Helper()
	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(body).Decode(&payload); err != nil {
		t.Fatalf("response is not the JSON error envelope: %v", err)
	}
	return payload.Error.Code
}

func TestBodyLimitRejectsOversizedUploadWithTypedError(t *testing.T) {
	called := false
	h := bodyLimit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))

	req := httptest.NewRequest(http.MethodPost, "/v1/media", strings.NewReader("x"))
	req.ContentLength = mediaUploadLimit + 1
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if called {
		t.Fatal("oversized upload must not reach the proxy")
	}
	if rec.Code != http.StatusBadRequest && rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status %d", rec.Code)
	}
	if code := errorCode(t, rec.Body); code != "media_too_large" {
		t.Fatalf("code %q", code)
	}
}

func TestBodyLimitAllowsVideoSizedUploadsButNotLargeJSON(t *testing.T) {
	ok := bodyLimit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, err := io.Copy(io.Discard, r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusRequestEntityTooLarge)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	upload := httptest.NewRequest(http.MethodPost, "/v1/media", strings.NewReader(strings.Repeat("a", 8<<20)))
	rec := httptest.NewRecorder()
	ok.ServeHTTP(rec, upload)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("an 8 MiB video upload must pass the edge (old limit was 6 MiB), got %d", rec.Code)
	}

	api := httptest.NewRequest(http.MethodPost, "/v1/appointments", strings.NewReader(strings.Repeat("a", 2<<20)))
	rec = httptest.NewRecorder()
	ok.ServeHTTP(rec, api)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("JSON endpoints stay capped at 1 MiB, got %d", rec.Code)
	}
}

func TestProxyErrorAlwaysReturnsJSON(t *testing.T) {
	cases := []struct {
		err    error
		status int
		code   string
	}{
		{errors.New("dial tcp: connection refused"), http.StatusBadGateway, "upstream_unavailable"},
		{&http.MaxBytesError{Limit: 1}, http.StatusBadRequest, "media_too_large"},
	}
	for _, tc := range cases {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/v1/media", nil)
		proxyError(rec, req, tc.err)
		if tc.status == http.StatusBadGateway && rec.Code != tc.status {
			t.Fatalf("status %d for %v", rec.Code, tc.err)
		}
		if code := errorCode(t, rec.Body); code != tc.code {
			t.Fatalf("code %q want %q", code, tc.code)
		}
	}
}

func TestRateLimitThrottlesPerIPAndIgnoresSpoofedForwardedFor(t *testing.T) {
	t.Setenv("RATE_LIMIT_LOGIN_PER_MIN", "3")
	h := rateLimit()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))

	send := func(xff string) int {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", nil)
		req.RemoteAddr = "203.0.113.9:4444"
		if xff != "" {
			req.Header.Set("X-Forwarded-For", xff)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	for i := 0; i < 3; i++ {
		if code := send("10.0.0." + string(rune('1'+i))); code != http.StatusOK {
			t.Fatalf("request %d blocked: %d", i, code)
		}
	}
	if code := send("10.9.9.9"); code != http.StatusTooManyRequests {
		t.Fatalf("spoofed X-Forwarded-For must not evade the limit, got %d", code)
	}
}

func TestEdgeDeadlinesGiveUploadsAndStreamsMinutes(t *testing.T) {
	up := httptest.NewRequest(http.MethodPost, "/v1/media", nil)
	if read, write, ok := edgeDeadlines(up); !ok || read < 5*time.Minute || write < 5*time.Minute {
		t.Fatalf("uploads need minutes, got %v/%v ok=%v", read, write, ok)
	}
	stream := httptest.NewRequest(http.MethodGet, "/v1/media/abc/content", nil)
	if _, write, ok := edgeDeadlines(stream); !ok || write < 10*time.Minute {
		t.Fatalf("video streaming needs a long write budget, got %v ok=%v", write, ok)
	}
	if _, _, ok := edgeDeadlines(httptest.NewRequest(http.MethodGet, "/v1/appointments", nil)); ok {
		t.Fatal("regular API calls keep the default tight deadlines")
	}
}
