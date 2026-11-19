package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGatewayBlocksInternalContactsLink(t *testing.T) {
	mux := http.NewServeMux()
	// Mirror production edge: /v1/internal/* is never proxied.
	mux.Handle("/v1/internal/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))

	req := httptest.NewRequest(http.MethodPost, "/v1/internal/contacts/link", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("want 404 from edge, got %d", rr.Code)
	}
}
