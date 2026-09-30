package service

import "testing"

func TestWorkTypeNeedsOrganization(t *testing.T) {
	if !workTypeNeedsOrganization("employee") {
		t.Fatal("employee needs salon")
	}
	if !workTypeNeedsOrganization("salon_owner") {
		t.Fatal("owner needs salon")
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
