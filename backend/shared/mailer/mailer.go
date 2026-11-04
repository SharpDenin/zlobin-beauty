package mailer

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// ErrNotConfigured means outbound email is unavailable (missing password / provider).
// Callers must not crash the process; auth endpoints should degrade safely.
var ErrNotConfigured = errors.New("mailer is not configured")

// Message is a provider-agnostic outbound email.
type Message struct {
	To      []string
	Subject string
	Text    string
	HTML    string
}

// Mailer sends transactional email. Business logic depends only on this interface.
type Mailer interface {
	// Ready reports whether Send is expected to succeed with current config.
	Ready() bool
	Send(ctx context.Context, msg Message) error
}

// Config holds provider settings loaded from the environment.
type Config struct {
	Provider string
	Host     string
	Port     int
	Username string
	Password string
	TLSMode  string // implicit | starttls | none
	// TLSServerName overrides the hostname used for TLS certificate verification / SNI.
	// Dial still uses Host. Needed when the SMTP banner cert is on a shared host
	// (e.g. REG.RU: dial smtp.example.com, verify hosting.reg.ru).
	TLSServerName string
	From          string
	FromName      string
}

func (c Config) FromHeader() string {
	name := strings.TrimSpace(c.FromName)
	from := strings.TrimSpace(c.From)
	if from == "" {
		from = c.Username
	}
	if name == "" {
		return from
	}
	return fmt.Sprintf("%s <%s>", name, from)
}

// NewFromEnv builds a Mailer from EMAIL_*/SMTP_* env vars.
// Missing SMTP_PASSWORD yields a Noop mailer that returns ErrNotConfigured on Send.
func NewFromEnv() Mailer {
	cfg := LoadConfigFromEnv()
	return New(cfg)
}

// New selects an implementation for cfg. Unknown/empty provider with no password → Noop.
func New(cfg Config) Mailer {
	provider := strings.ToLower(strings.TrimSpace(cfg.Provider))
	if provider == "" {
		provider = "smtp"
	}
	switch provider {
	case "smtp":
		if strings.TrimSpace(cfg.Password) == "" || strings.TrimSpace(cfg.Host) == "" {
			return Noop{}
		}
		return NewSMTP(cfg)
	case "noop", "none", "disabled":
		return Noop{}
	default:
		// Future API providers (SendGrid, etc.) plug in here without touching auth services.
		if strings.TrimSpace(cfg.Password) == "" {
			return Noop{}
		}
		return NewSMTP(cfg)
	}
}
