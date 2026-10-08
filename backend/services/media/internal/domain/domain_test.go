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
	if !ContentAllowedForPurpose(PurposeMessage, "image/gif") {
		t.Fatal("chat media must allow GIF")
	}
	if ContentAllowedForPurpose(PurposeMessage, "application/pdf") {
		t.Fatal("chat media must not allow pdf")
	}
	if MaxBytesForPurpose(PurposeMessage) != MaxVideoUploadBytes {
		t.Fatal("chat uploads use the video size ceiling, then image size is enforced after type detection")
	}
	if MaxBytesForContentType("image/jpeg") != MaxUploadBytes || MaxBytesForContentType("video/mp4") != MaxVideoUploadBytes {
		t.Fatal("size ceilings must follow the detected type")
	}
}

func TestBeforeAfterIsAppointmentScopedNotShared(t *testing.T) {
	if IsSharedPurpose(PurposeBeforeAfter) || IsPublicPurpose(PurposeBeforeAfter) {
		t.Fatal("before/after photos must only be visible to appointment participants")
	}
	if !IsAppointmentPurpose(PurposeBeforeAfter) {
		t.Fatal("before_after is appointment scoped")
	}
}

func TestSniffContentType(t *testing.T) {
	cases := map[string][]byte{
		"image/jpeg":      {0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10},
		"image/png":       {0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n', 0, 0},
		"image/gif":       []byte("GIF89a\x01\x00"),
		"image/webp":      []byte("RIFF\x24\x00\x00\x00WEBPVP8 "),
		"application/pdf": []byte("%PDF-1.7\n"),
		"video/webm":      {0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42},
		"video/mp4":       []byte("\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00"),
		"video/quicktime": []byte("\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00"),
	}
	for want, head := range cases {
		if got := SniffContentType(head); got != want {
			t.Fatalf("sniff %s: got %q", want, got)
		}
	}
	for name, head := range map[string][]byte{
		"html":  []byte("<html><script>alert(1)</script></html>"),
		"svg":   []byte("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
		"exe":   []byte("MZ\x90\x00\x03\x00"),
		"empty": {},
		"heic":  []byte("\x00\x00\x00\x18ftypheic\x00\x00\x00\x00"),
	} {
		if got := SniffContentType(head); got != "" {
			t.Fatalf("%s must not be accepted, got %q", name, got)
		}
	}
}

func TestDeclaredCompatible(t *testing.T) {
	if !DeclaredCompatible("", "image/png") || !DeclaredCompatible("application/octet-stream", "image/png") {
		t.Fatal("unknown declarations defer to the sniffed type")
	}
	if !DeclaredCompatible("video/quicktime", "video/mp4") || !DeclaredCompatible("image/jpg", "image/jpeg") {
		t.Fatal("common client aliases must be accepted")
	}
	if DeclaredCompatible("image/png", "application/pdf") || DeclaredCompatible("image/jpeg", "video/mp4") {
		t.Fatal("mismatched declarations must be rejected (MIME spoofing)")
	}
}

func TestContentAllowedForPurposeRules(t *testing.T) {
	if ContentAllowedForPurpose(PurposeProduct, "image/gif") {
		t.Fatal("product photos do not take GIFs")
	}
	if !ContentAllowedForPurpose(PurposePortfolio, "image/gif") || !ContentAllowedForPurpose(PurposePortfolio, "video/mp4") {
		t.Fatal("portfolio takes photos, GIFs and video")
	}
	if ContentAllowedForPurpose(PurposeProfile, "video/mp4") {
		t.Fatal("profile photos are images only")
	}
	if !ContentAllowedForPurpose(PurposeDocument, "application/pdf") || ContentAllowedForPurpose(PurposePortfolio, "application/pdf") {
		t.Fatal("pdf is documents only")
	}
}
