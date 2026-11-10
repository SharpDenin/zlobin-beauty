package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestDeleteMyAccountRequiresPassword(t *testing.T) {
	s := New(nil, "test-jwt-secret-key-32-characters!!")
	err := s.DeleteMyAccount(t.Context(), uuid.New(), "  ")
	ae, ok := apperr.As(err)
	if !ok || ae.HTTPStatus != 400 {
		t.Fatalf("expected validation, got %v", err)
	}
}

func TestListOwnedOrganizationsFailClosedForSalonOwner(t *testing.T) {
	s := New(nil, "test-jwt-secret-key-32-characters!!")
	_, err := s.listOwnedOrganizations(t.Context(), uuid.New(), []string{domain.RoleSalonOwner})
	ae, ok := apperr.As(err)
	if !ok || ae.HTTPStatus != 409 {
		t.Fatalf("expected conflict when orgs URL missing, got %v", err)
	}
}

func TestListOwnedOrganizationsAllowsClientWithoutOrgsURL(t *testing.T) {
	s := New(nil, "test-jwt-secret-key-32-characters!!")
	items, err := s.listOwnedOrganizations(t.Context(), uuid.New(), []string{domain.RoleClient})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatalf("expected empty, got %#v", items)
	}
}

func TestListOwnedOrganizationsParsesItems(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Internal-Token") != "tok" {
			t.Fatalf("missing internal token")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"items": []map[string]string{{"id": "1", "name": "Salon A", "type": "salon"}},
		})
	}))
	t.Cleanup(srv.Close)

	s := New(nil, "test-jwt-secret-key-32-characters!!").
		WithAccountDeleteDeps(srv.URL, "", "", "tok")
	items, err := s.listOwnedOrganizations(t.Context(), uuid.New(), []string{domain.RoleSalonOwner})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Name != "Salon A" {
		t.Fatalf("got %#v", items)
	}
}

func TestAccountOwnedOrganizationsErrorCode(t *testing.T) {
	ae := apperr.AccountOwnedOrganizations([]string{"My Salon"})
	if ae.Code != apperr.CodeAccountOwnedOrganizations {
		t.Fatalf("code %s", ae.Code)
	}
	if ae.HTTPStatus != 409 {
		t.Fatalf("status %d", ae.HTTPStatus)
	}
}
