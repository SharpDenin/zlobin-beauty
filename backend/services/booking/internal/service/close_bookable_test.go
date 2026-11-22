package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestRequireBranchBookableRejectsInactive(t *testing.T) {
	branchID := uuid.Must(uuid.NewV7())
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"branch_published": false,
			"org_published":    true,
			"branch_active":    false,
		})
	}))
	defer srv.Close()

	s := &Service{organizationsURL: srv.URL, internalToken: "tok", httpClient: srv.Client()}
	err := s.requireBranchBookable(context.Background(), branchID)
	if err == nil {
		t.Fatal("expected conflict for closed branch")
	}
}

func TestRequireBranchBookableAllowsActive(t *testing.T) {
	branchID := uuid.Must(uuid.NewV7())
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"branch_published": true,
			"org_published":    true,
			"branch_active":    true,
		})
	}))
	defer srv.Close()

	s := &Service{organizationsURL: srv.URL, internalToken: "tok", httpClient: srv.Client()}
	if err := s.requireBranchBookable(context.Background(), branchID); err != nil {
		t.Fatal(err)
	}
}
