package main

import "testing"

func TestEmailLocalPart(t *testing.T) {
	if got := emailLocalPart("Master1@demo.local"); got != "master1" {
		t.Fatalf("got %q", got)
	}
}

func TestSeedMediaSlug(t *testing.T) {
	if got := seedMediaSlug("Стрижка женская"); got != "стрижка-женская" {
		t.Fatalf("got %q", got)
	}
	if got := seedMediaSlug("  Dia Richesse  "); got != "dia-richesse" {
		t.Fatalf("got %q", got)
	}
}

func TestContentTypeForExt(t *testing.T) {
	if contentTypeForExt(".JPG") != "image/jpeg" {
		t.Fatal("jpg")
	}
	if contentTypeForExt(".webm") != "video/webm" {
		t.Fatal("webm")
	}
	if contentTypeForExt(".txt") != "" {
		t.Fatal("unsupported should be empty")
	}
}
