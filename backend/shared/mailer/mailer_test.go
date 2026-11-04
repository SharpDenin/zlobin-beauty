package mailer

import (
	"context"
	"errors"
	"testing"
)

func TestNoopNotConfigured(t *testing.T) {
	m := Noop{}
	if m.Ready() {
		t.Fatal("noop should not be ready")
	}
	if err := m.Send(context.Background(), Message{To: []string{"a@b.c"}, Subject: "x", Text: "y"}); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("got %v", err)
	}
}

func TestNewWithoutPasswordIsNoop(t *testing.T) {
	m := New(Config{Provider: "smtp", Host: "smtp.example.com", Port: 465, Username: "u", From: "u@example.com"})
	if m.Ready() {
		t.Fatal("expected not ready")
	}
}

func TestMockRecords(t *testing.T) {
	m := NewMock(true)
	if err := m.Send(context.Background(), Message{To: []string{"a@b.c"}, Subject: "Hi", Text: "Body"}); err != nil {
		t.Fatal(err)
	}
	last, ok := m.Last()
	if !ok || last.Subject != "Hi" {
		t.Fatalf("unexpected %#v", last)
	}
}

func TestFromHeader(t *testing.T) {
	cfg := Config{From: "no-reply@salon-x.ru", FromName: "Salon-X"}
	if got := cfg.FromHeader(); got != "Salon-X <no-reply@salon-x.ru>" {
		t.Fatalf("got %q", got)
	}
}

func TestTLSServerNameOverride(t *testing.T) {
	s := NewSMTP(Config{Host: "smtp.salon-x.ru", TLSServerName: "hosting.reg.ru"})
	if s.tlsServerName() != "hosting.reg.ru" {
		t.Fatalf("got %q", s.tlsServerName())
	}
	s2 := NewSMTP(Config{Host: "smtp.example.com"})
	if s2.tlsServerName() != "smtp.example.com" {
		t.Fatalf("got %q", s2.tlsServerName())
	}
}
