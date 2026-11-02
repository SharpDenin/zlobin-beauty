// Command smtprobe checks REG.RU SMTP connectivity and optionally sends one test message.
// Secrets come only from the environment; never printed.
package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"github.com/zlobin/zlobin-beauty/backend/shared/mailer"
)

func main() {
	host := env("SMTP_HOST", "smtp.salon-x.ru")
	port := env("SMTP_PORT", "465")
	addr := net.JoinHostPort(host, port)

	fmt.Println("probe: dns+dial", host)
	ips, err := net.LookupIP(host)
	if err != nil {
		fail("dns", err)
	}
	fmt.Println("probe: dns_ok addresses", len(ips))

	d := net.Dialer{Timeout: 10 * time.Second}
	raw, err := d.Dial("tcp", addr)
	if err != nil {
		fail("tcp", err)
	}
	_ = raw.Close()
	fmt.Println("probe: tcp_ok", addr)

	cfg := mailer.LoadConfigFromEnv()
	tlsName := strings.TrimSpace(cfg.TLSServerName)
	if tlsName == "" {
		tlsName = host
	}
	tlsCfg := &tls.Config{ServerName: tlsName, MinVersion: tls.VersionTLS12}
	conn, err := tls.DialWithDialer(&d, "tcp", addr, tlsCfg)
	if err != nil {
		fail("tls", err)
	}
	state := conn.ConnectionState()
	fmt.Printf("probe: tls_ok server_name=%s version=%x\n", tlsName, state.Version)
	_ = conn.Close()

	m := mailer.New(cfg)
	if !m.Ready() {
		fail("mailer", fmt.Errorf("not ready (missing password/host/from)"))
	}
	fmt.Println("probe: mailer_ready provider=smtp tls_mode="+cfg.TLSMode)

	to := strings.TrimSpace(os.Getenv("SMTP_TEST_TO"))
	if to == "" {
		fmt.Println("probe: skip_send (set SMTP_TEST_TO to send one test message)")
		fmt.Println("probe: smtp_auth deferred_until_send")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	err = m.Send(ctx, mailer.Message{
		To:      []string{to},
		Subject: "Salon-X SMTP test",
		Text:    "Это тестовое письмо Salon-X. Если вы его видите, SMTP работает.\n",
		HTML:    "<p>Это тестовое письмо <strong>Salon-X</strong>. Если вы его видите, SMTP работает.</p>",
	})
	if err != nil {
		fail("send", err)
	}
	fmt.Println("probe: smtp_accepted from=" + cfg.From)
}

func env(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func fail(step string, err error) {
	msg := err.Error()
	if p := os.Getenv("SMTP_PASSWORD"); p != "" {
		msg = strings.ReplaceAll(msg, p, "<redacted>")
	}
	fmt.Fprintf(os.Stderr, "probe: %s_fail %s\n", step, msg)
	os.Exit(1)
}
