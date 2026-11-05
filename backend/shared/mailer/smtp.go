package mailer

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"
)

// SMTP sends mail over SMTP. TLS modes: implicit (465), starttls, none.
type SMTP struct {
	cfg Config
}

func NewSMTP(cfg Config) *SMTP {
	return &SMTP{cfg: cfg}
}

func (s *SMTP) Ready() bool {
	return strings.TrimSpace(s.cfg.Password) != "" && strings.TrimSpace(s.cfg.Host) != "" && strings.TrimSpace(s.cfg.From) != ""
}

func (s *SMTP) Send(ctx context.Context, msg Message) error {
	if !s.Ready() {
		return ErrNotConfigured
	}
	if len(msg.To) == 0 {
		return fmt.Errorf("mailer: no recipients")
	}
	addr := fmt.Sprintf("%s:%d", s.cfg.Host, s.cfg.Port)
	auth := smtp.PlainAuth("", s.cfg.Username, s.cfg.Password, s.cfg.Host)
	body := buildMIME(s.cfg.FromHeader(), msg)

	deadline := time.Now().Add(20 * time.Second)
	if dl, ok := ctx.Deadline(); ok && dl.Before(deadline) {
		deadline = dl
	}

	switch strings.ToLower(s.cfg.TLSMode) {
	case "implicit", "ssl", "tls":
		return s.sendImplicit(addr, auth, msg.To, body, deadline)
	case "starttls":
		return s.sendStartTLS(addr, auth, msg.To, body, deadline)
	case "none", "plain":
		d := net.Dialer{Deadline: deadline}
		conn, err := d.DialContext(ctx, "tcp", addr)
		if err != nil {
			return err
		}
		defer conn.Close()
		_ = conn.SetDeadline(deadline)
		return smtpSend(conn, s.cfg.Host, auth, s.cfg.From, msg.To, body)
	default:
		return s.sendImplicit(addr, auth, msg.To, body, deadline)
	}
}

func (s *SMTP) tlsServerName() string {
	if name := strings.TrimSpace(s.cfg.TLSServerName); name != "" {
		return name
	}
	return s.cfg.Host
}

func (s *SMTP) sendImplicit(addr string, auth smtp.Auth, to []string, body []byte, deadline time.Time) error {
	tlsCfg := &tls.Config{ServerName: s.tlsServerName(), MinVersion: tls.VersionTLS12}
	dialer := &net.Dialer{Deadline: deadline}
	conn, err := tls.DialWithDialer(dialer, "tcp", addr, tlsCfg)
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetDeadline(deadline)
	return smtpSend(conn, s.cfg.Host, auth, s.cfg.From, to, body)
}

func (s *SMTP) sendStartTLS(addr string, auth smtp.Auth, to []string, body []byte, deadline time.Time) error {
	dialer := &net.Dialer{Deadline: deadline}
	conn, err := dialer.Dial("tcp", addr)
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetDeadline(deadline)
	client, err := smtp.NewClient(conn, s.cfg.Host)
	if err != nil {
		return err
	}
	defer client.Close()
	if ok, _ := client.Extension("STARTTLS"); ok {
		if err := client.StartTLS(&tls.Config{ServerName: s.tlsServerName(), MinVersion: tls.VersionTLS12}); err != nil {
			return err
		}
	}
	if err := client.Auth(auth); err != nil {
		return err
	}
	if err := client.Mail(s.cfg.From); err != nil {
		return err
	}
	for _, rcpt := range to {
		if err := client.Rcpt(rcpt); err != nil {
			return err
		}
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(body); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return client.Quit()
}

func smtpSend(conn net.Conn, host string, auth smtp.Auth, from string, to []string, body []byte) error {
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer client.Close()
	if err := client.Auth(auth); err != nil {
		return err
	}
	if err := client.Mail(from); err != nil {
		return err
	}
	for _, rcpt := range to {
		if err := client.Rcpt(rcpt); err != nil {
			return err
		}
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(body); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return client.Quit()
}

func buildMIME(from string, msg Message) []byte {
	var b strings.Builder
	b.WriteString("From: " + from + "\r\n")
	b.WriteString("To: " + strings.Join(msg.To, ", ") + "\r\n")
	b.WriteString("Subject: " + msg.Subject + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	if strings.TrimSpace(msg.HTML) != "" {
		b.WriteString("Content-Type: text/html; charset=UTF-8\r\n\r\n")
		b.WriteString(msg.HTML)
	} else {
		b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
		b.WriteString(msg.Text)
	}
	return []byte(b.String())
}
