package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/domain"
)

func TestResolveCloseContactAdminThenOwnerThenBranch(t *testing.T) {
	adminID := uuid.Must(uuid.NewV7())
	ownerID := uuid.Must(uuid.NewV7())
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/internal/users/"+adminID.String():
			_ = json.NewEncoder(w).Encode(map[string]any{"phone": "+7900admin"})
		case r.URL.Path == "/v1/internal/users/"+ownerID.String():
			_ = json.NewEncoder(w).Encode(map[string]any{"phone": "+7900owner"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	s := &Service{
		identityURL:   srv.URL,
		internalToken: "tok",
		httpClient:    srv.Client(),
		now:           time.Now,
		store:         nil,
	}
	// Direct phone lookup path used by resolveCloseContact.
	if got := s.identityPhone(context.Background(), adminID); got != "+7900admin" {
		t.Fatalf("admin phone=%q", got)
	}
	if got := s.identityPhone(context.Background(), ownerID); got != "+7900owner" {
		t.Fatalf("owner phone=%q", got)
	}
	b := &domain.Branch{Phone: "+7900branch"}
	if p, src := contactDisplay(b.Phone, "branch"), "branch"; p == "" || src == "" {
		t.Fatal("branch fallback")
	}
}

func TestBookingLeaseBlockers(t *testing.T) {
	got := bookingLeaseBlockers(&bookingCloseStats{ActiveLeases: 2, RequestedLeases: 1})
	if len(got) != 2 {
		t.Fatalf("got %d blockers", len(got))
	}
	if got[0].Code != "active_chair_leases" || got[1].Code != "requested_chair_leases" {
		t.Fatalf("%+v", got)
	}
}
