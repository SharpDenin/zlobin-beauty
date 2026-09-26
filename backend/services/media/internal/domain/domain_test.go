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

func TestPurposeMessageIsPrivate(t *testing.T) {
	if !ValidPurpose(PurposeMessage) {
		t.Fatal("purpose=message must be a valid upload purpose")
	}
	if IsSharedPurpose(PurposeMessage) {
		t.Fatal("chat media must not be readable by arbitrary authenticated users")
	}
	if IsPublicPurpose(PurposeMessage) {
		t.Fatal("chat media must not be public")
	}
	if !AllowsVideo(PurposeMessage) {
		t.Fatal("chat media must allow video")
	}
	if !ContentAllowedForPurpose(PurposeMessage, "image/jpeg") || !ContentAllowedForPurpose(PurposeMessage, "video/webm") {
		t.Fatal("chat media must allow jpeg and webm")
	}
	if ContentAllowedForPurpose(PurposeMessage, "application/pdf") {
		t.Fatal("chat media must not allow pdf")
	}
	if MaxBytesForPurpose(PurposeMessage) != MaxVideoUploadBytes {
		t.Fatal("chat uploads use the video size ceiling, then image size is enforced after type detection")
	}
}
