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

func TestOwnerPhonePreferredOverBranchWhenAdminHasNoPhone(t *testing.T) {
	adminID := uuid.Must(uuid.NewV7())
	ownerID := uuid.Must(uuid.NewV7())

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/internal/users/" + adminID.String():
			_ = json.NewEncoder(w).Encode(map[string]any{"phone": ""})
		case "/v1/internal/users/" + ownerID.String():
			_ = json.NewEncoder(w).Encode(map[string]any{"phone": "+7900owner99"})
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
	}

	members := []domain.Membership{
		{UserID: adminID, Role: "admin", Status: "active", CreatedAt: time.Unix(1, 0).UTC()},
		{UserID: ownerID, Role: "owner", Status: "active", CreatedAt: time.Unix(2, 0).UTC()},
	}
	b := &domain.Branch{Phone: "+7900branch99"}

	phone, source := s.selectCloseContact(context.Background(), members, b)
	if source != "owner" || phone != "+7900owner99" {
		t.Fatalf("want owner/+7900owner99, got %s/%s", source, phone)
	}
}
