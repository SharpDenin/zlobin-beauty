package service

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func strPtr(s string) *string { return &s }

func TestResolveBookingWorkspaceUsesServiceOrgWhenProfileUnbound(t *testing.T) {
	serviceID := uuid.MustParse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
	serviceOrg := uuid.MustParse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
	payload := &masterPayload{}
	payload.Master.City = "Красноярск"
	payload.Services = []struct {
		ID              string `json:"id"`
		Name            string `json:"name"`
		DurationMinutes int    `json:"duration_minutes"`
		PriceMinor      int64  `json:"price_minor"`
		Currency        string `json:"currency"`
		OrganizationID  string `json:"organization_id"`
	}{
		{
			ID: serviceID.String(), Name: "Стрижка", DurationMinutes: 60,
			PriceMinor: 300000, Currency: "RUB", OrganizationID: serviceOrg.String(),
		},
	}

	ws, err := resolveBookingWorkspace(payload, serviceID)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if ws.OrgID != serviceOrg {
		t.Fatalf("org=%s want %s", ws.OrgID, serviceOrg)
	}
	if ws.BranchID != uuid.Nil {
		t.Fatalf("branch=%s want nil for unbound private master", ws.BranchID)
	}
	if ws.ServiceName != "Стрижка" || ws.DurationMinutes != 60 || ws.PriceMinor != 300000 {
		t.Fatalf("service fields not copied: %+v", ws)
	}
	if ws.MasterCity != "Красноярск" {
		t.Fatalf("city=%q", ws.MasterCity)
	}
}

func TestResolveBookingWorkspaceKeepsProfileOrgAndBranch(t *testing.T) {
	serviceID := uuid.MustParse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
	profileOrg := uuid.MustParse("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
	profileBranch := uuid.MustParse("dddddddd-dddd-4ddd-8ddd-dddddddddddd")
	serviceOrg := uuid.MustParse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
	payload := &masterPayload{}
	payload.Master.OrganizationID = strPtr(profileOrg.String())
	payload.Master.BranchID = strPtr(profileBranch.String())
	payload.Services = []struct {
		ID              string `json:"id"`
		Name            string `json:"name"`
		DurationMinutes int    `json:"duration_minutes"`
		PriceMinor      int64  `json:"price_minor"`
		Currency        string `json:"currency"`
		OrganizationID  string `json:"organization_id"`
	}{
		{ID: serviceID.String(), Name: "Окрашивание", DurationMinutes: 90, OrganizationID: serviceOrg.String()},
	}

	ws, err := resolveBookingWorkspace(payload, serviceID)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if ws.OrgID != profileOrg || ws.BranchID != profileBranch {
		t.Fatalf("want profile workspace, got org=%s branch=%s", ws.OrgID, ws.BranchID)
	}
}

func TestResolveBookingWorkspaceRejectsMissingServiceAndOrg(t *testing.T) {
	serviceID := uuid.MustParse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
	payload := &masterPayload{}
	_, err := resolveBookingWorkspace(payload, serviceID)
	if err == nil || !strings.Contains(err.Error(), "service is not offered") {
		t.Fatalf("want service validation, got %v", err)
	}
	ae, ok := apperr.As(err)
	if !ok || ae.Code != apperr.CodeValidation {
		t.Fatalf("want validation AppError, got %#v", err)
	}

	payload.Services = []struct {
		ID              string `json:"id"`
		Name            string `json:"name"`
		DurationMinutes int    `json:"duration_minutes"`
		PriceMinor      int64  `json:"price_minor"`
		Currency        string `json:"currency"`
		OrganizationID  string `json:"organization_id"`
	}{
		{ID: serviceID.String(), Name: "Стрижка", DurationMinutes: 30},
	}
	_, err = resolveBookingWorkspace(payload, serviceID)
	if err == nil || !strings.Contains(err.Error(), "workspace organization") {
		t.Fatalf("want workspace org validation, got %v", err)
	}
}

func TestParseOptionalUUIDString(t *testing.T) {
	if parseOptionalUUIDString(nil) != uuid.Nil {
		t.Fatal("nil ptr")
	}
	empty := ""
	if parseOptionalUUIDString(&empty) != uuid.Nil {
		t.Fatal("empty")
	}
	bad := "not-a-uuid"
	if parseOptionalUUIDString(&bad) != uuid.Nil {
		t.Fatal("bad")
	}
	id := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	raw := id.String()
	if parseOptionalUUIDString(&raw) != id {
		t.Fatal("good")
	}
}
