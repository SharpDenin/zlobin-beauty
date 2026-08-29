package domain

import "testing"

func TestPurposeServiceIsPublicCatalogMedia(t *testing.T) {
	if !ValidPurpose(PurposeService) {
		t.Fatal("purpose=service must be a valid upload purpose")
	}
	if !IsSharedPurpose(PurposeService) {
		t.Fatal("service photos must be readable by authenticated clients")
	}
	if !IsPublicPurpose(PurposeService) {
		t.Fatal("service photos must be public for booking catalog guests")
	}
}
