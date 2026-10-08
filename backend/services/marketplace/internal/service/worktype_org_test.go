package service

import "testing"

func TestWorkTypeNeedsOrganization(t *testing.T) {
	if !workTypeNeedsOrganization("employee") {
		t.Fatal("employee needs salon")
	}
	if !workTypeNeedsOrganization("salon_owner") {
		t.Fatal("owner needs salon")
	}
	if !workTypeNeedsOrganization("owner") {
		t.Fatal("legacy owner alias needs salon")
	}
	if !workTypeNeedsOrganization("chair_master") {
		t.Fatal("chair_master alias needs salon")
	}
	if workTypeNeedsOrganization("independent") {
		t.Fatal("independent must work without salon")
	}
	if workTypeNeedsOrganization("private_master") {
		t.Fatal("private master must work without salon")
	}
	if workTypeNeedsOrganization("mobile_master") {
		t.Fatal("mobile master must work without salon")
	}
}

func TestNormalizeWorkTypesPrimary(t *testing.T) {
	types, primary, err := normalizeWorkTypes([]string{"independent", "employee", "private_master"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if primary != "employee" {
		t.Fatalf("primary=%s", primary)
	}
	if len(types) != 2 {
		t.Fatalf("expected deduped types, got %#v", types)
	}
}
