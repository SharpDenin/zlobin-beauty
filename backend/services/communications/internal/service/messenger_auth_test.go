package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestCreateConversationRejectsUnsupportedType(t *testing.T) {
	s := New(nil, "")
	_, err := s.CreateConversation(context.Background(), CreateConversationInput{
		ActorID: uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		Type:    "client_supplier",
	})
	if err == nil {
		t.Fatal("client_supplier must be rejected")
	}
	ae, ok := apperr.As(err)
	if !ok || ae.HTTPStatus != 400 {
		t.Fatalf("expected validation, got %v", err)
	}
}

func TestCreateClientMasterAllowsUnpublishedMasterProfile(t *testing.T) {
	// MSG-01: client → master only requires an existing master profile (not published).
	master := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	client := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/v1/internal/masters/by-user/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"published": false, "id": uuid.New().String(), "user_id": master.String()})
		case strings.Contains(r.URL.Path, "/v1/internal/users/"+master.String()):
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "active", "display_name": "M"})
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(ts.Close)
	s := New(nil, "")
	s.WithMessenger(MessengerDeps{MarketplaceURL: ts.URL, IdentityURL: ts.URL, InternalToken: "tok"})
	// Without store, findOrInsert will panic/nil — only validate gates before insert via profile/active checks.
	// Call createClientMaster gates by exercising CreateConversation; nil store fails at findOrInsert.
	_, err := s.CreateConversation(context.Background(), CreateConversationInput{
		ActorID:      client,
		Type:         domain.ConversationClientMaster,
		MasterUserID: &master,
	})
	// Expected: passes policy gates then fails on nil store (internal) — not 403 unpublished.
	if err == nil {
		t.Fatal("expected store failure without DB")
	}
	if ae, ok := apperr.As(err); ok && ae.HTTPStatus == 403 {
		t.Fatalf("unpublished master must not be forbidden for client→master: %v", err)
	}
}

func TestCreateClientMasterRejectsMissingMasterProfile(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/v1/internal/masters/by-user/"):
			w.WriteHeader(http.StatusNotFound)
		case strings.Contains(r.URL.Path, "/v1/internal/users/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "active", "display_name": "X"})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(ts.Close)
	s := New(nil, "")
	s.WithMessenger(MessengerDeps{MarketplaceURL: ts.URL, IdentityURL: ts.URL, InternalToken: "tok"})
	master := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	_, err := s.CreateConversation(context.Background(), CreateConversationInput{
		ActorID:      uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		Type:         domain.ConversationClientMaster,
		MasterUserID: &master,
	})
	if err == nil {
		t.Fatal("expected not found")
	}
	ae, ok := apperr.As(err)
	if !ok || ae.HTTPStatus != 404 {
		t.Fatalf("expected 404, got %v", err)
	}
}

func TestCreateClientMasterMasterToClientWithoutBooking(t *testing.T) {
	// MSG-01: master → client no longer requires booking/address-book.
	client := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	master := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/v1/internal/masters/by-user/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"published": false, "id": uuid.New().String()})
		case strings.Contains(r.URL.Path, "/v1/internal/users/"+client.String()):
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "active", "display_name": "C"})
		case strings.Contains(r.URL.Path, "/v1/internal/client-master-relationship"):
			t.Fatal("booking relationship must not be required")
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(ts.Close)
	s := New(nil, "")
	s.WithMessenger(MessengerDeps{MarketplaceURL: ts.URL, IdentityURL: ts.URL, InternalToken: "tok"})
	_, err := s.CreateConversation(context.Background(), CreateConversationInput{
		ActorID:      master,
		Type:         domain.ConversationClientMaster,
		ClientUserID: &client,
	})
	if err == nil {
		t.Fatal("expected store failure without DB")
	}
	if ae, ok := apperr.As(err); ok && (ae.HTTPStatus == 403 || strings.Contains(err.Error(), "booking")) {
		t.Fatalf("master→client must not require booking: %v", err)
	}
}

func TestFetchSupplierOrgForUser(t *testing.T) {
	orgID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	ownerID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "/supplier-organization") {
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"organization_id": orgID.String()})
	}))
	t.Cleanup(ts.Close)
	s := New(nil, "")
	s.WithMessenger(MessengerDeps{OrganizationsURL: ts.URL, InternalToken: "tok"})
	got, err := s.fetchSupplierOrgForUser(context.Background(), ownerID)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if got != orgID {
		t.Fatalf("got %s want %s", got, orgID)
	}
}

func TestCreateMasterSupplierRejectsNonMaster(t *testing.T) {
	orgID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	ownerID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/members"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items": []map[string]string{{"user_id": ownerID.String(), "status": "active"}},
			})
		case strings.Contains(r.URL.Path, "/v1/internal/organizations/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"type": "supplier", "published": true})
		case strings.Contains(r.URL.Path, "/v1/internal/masters/by-user/"):
			w.WriteHeader(http.StatusNotFound)
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(ts.Close)
	s := New(nil, "")
	s.WithMessenger(MessengerDeps{OrganizationsURL: ts.URL, MarketplaceURL: ts.URL, InternalToken: "tok"})
	_, err := s.CreateConversation(context.Background(), CreateConversationInput{
		ActorID:                uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		Type:                   domain.ConversationMasterSupplier,
		SupplierOrganizationID: &orgID,
	})
	assertForbidden(t, err)
}

func assertForbidden(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("expected forbidden")
	}
	ae, ok := apperr.As(err)
	if !ok || ae.HTTPStatus != 403 {
		t.Fatalf("expected 403, got %v", err)
	}
}
