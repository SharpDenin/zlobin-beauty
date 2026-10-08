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

func TestCreateClientMasterRejectsUnpublishedMaster(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "/v1/internal/masters/by-user/") {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"published": false})
	}))
	t.Cleanup(ts.Close)
	s := New(nil, "")
	s.WithMessenger(MessengerDeps{MarketplaceURL: ts.URL, InternalToken: "tok"})
	master := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	_, err := s.CreateConversation(context.Background(), CreateConversationInput{
		ActorID:      uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		Type:         domain.ConversationClientMaster,
		MasterUserID: &master,
	})
	assertForbidden(t, err)
}

func TestCreateClientMasterMasterRequiresBooking(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/v1/internal/masters/by-user/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"published": true})
		case strings.Contains(r.URL.Path, "/v1/internal/client-master-relationship"):
			_ = json.NewEncoder(w).Encode(map[string]any{"related": false})
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(ts.Close)
	s := New(nil, ts.URL)
	s.WithMessenger(MessengerDeps{MarketplaceURL: ts.URL, InternalToken: "tok"})
	client := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	_, err := s.CreateConversation(context.Background(), CreateConversationInput{
		ActorID:      uuid.MustParse("22222222-2222-2222-2222-222222222222"),
		Type:         domain.ConversationClientMaster,
		ClientUserID: &client,
	})
	assertForbidden(t, err)
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
			_ = json.NewEncoder(w).Encode(map[string]any{"published": false})
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
