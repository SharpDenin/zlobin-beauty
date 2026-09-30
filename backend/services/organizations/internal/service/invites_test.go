package service

import "testing"

func TestHashInviteToken(t *testing.T) {
	a := hashInviteToken("abc")
	b := hashInviteToken("abc")
	c := hashInviteToken("abd")
	if a != b || a == "" {
		t.Fatal("hash must be deterministic and non-empty")
	}
	if a == c {
		t.Fatal("different tokens must not collide")
	}
}
