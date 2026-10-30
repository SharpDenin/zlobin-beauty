package service

import "testing"

func TestWorkTypeNeedsOrganizationNeverFromFormat(t *testing.T) {
	for _, code := range []string{
		"private_practice", "percentage_based", "mobile_service", "chair_rental",
		"employee", "salon_owner", "owner", "chair_master", "independent", "mobile_master",
	} {
		if workTypeNeedsOrganization(code) {
			t.Fatalf("%s must not require organization from format alone", code)
		}
	}
	if workTypesNeedOrganization([]string{"chair_rental", "percentage_based"}) {
		t.Fatal("formats must not require organization")
	}
}

func TestNormalizeWorkTypesAliasesAndPrimary(t *testing.T) {
	types, primary, err := normalizeWorkTypes([]string{"independent", "chair_master", "private_master", "mobile_master"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if primary != "private_practice" {
		t.Fatalf("primary=%s want private_practice (first element)", primary)
	}
	want := []string{"private_practice", "chair_rental", "mobile_service"}
	if len(types) != len(want) {
		t.Fatalf("got %#v", types)
	}
	for i := range want {
		if types[i] != want[i] {
			t.Fatalf("got %#v want %#v", types, want)
		}
	}
}

func TestNormalizeWorkTypesRejectsEmployeeAndOwnership(t *testing.T) {
	if _, _, err := normalizeWorkTypes([]string{"employee"}, ""); err == nil {
		t.Fatal("employee must be rejected as a format")
	}
	if _, _, err := normalizeWorkTypes([]string{"salon_owner"}, ""); err == nil {
		t.Fatal("salon_owner-only input must be rejected")
	}
	if _, _, err := normalizeWorkTypes([]string{"owner", "chain_owner"}, ""); err == nil {
		t.Fatal("ownership-only input must be rejected")
	}
}

func TestNormalizeWorkTypeAliases(t *testing.T) {
	cases := map[string]string{
		"independent":     "private_practice",
		"private_master":  "private_practice",
		"mobile_master":   "mobile_service",
		"renter":          "chair_rental",
		"chair_master":    "chair_rental",
		"percentage_based": "percentage_based",
		"owner":           "",
		"salon_owner":     "",
	}
	for in, want := range cases {
		if got := normalizeWorkType(in); got != want {
			t.Fatalf("%s -> %s want %s", in, got, want)
		}
	}
}
