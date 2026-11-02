package mailer

import (
	"os"
	"strconv"
	"strings"
)

// LoadConfigFromEnv reads EMAIL_* / SMTP_* without panicking on missing password.
func LoadConfigFromEnv() Config {
	port := 465
	if v := strings.TrimSpace(os.Getenv("SMTP_PORT")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			port = n
		}
	}
	tlsMode := strings.ToLower(strings.TrimSpace(os.Getenv("SMTP_TLS_MODE")))
	if tlsMode == "" {
		tlsMode = "implicit"
	}
	from := strings.TrimSpace(os.Getenv("EMAIL_FROM"))
	if from == "" {
		from = strings.TrimSpace(os.Getenv("SMTP_USERNAME"))
	}
	return Config{
		Provider:      strings.TrimSpace(os.Getenv("EMAIL_PROVIDER")),
		Host:          strings.TrimSpace(os.Getenv("SMTP_HOST")),
		Port:          port,
		Username:      strings.TrimSpace(os.Getenv("SMTP_USERNAME")),
		Password:      os.Getenv("SMTP_PASSWORD"), // may be empty — never log
		TLSMode:       tlsMode,
		TLSServerName: strings.TrimSpace(os.Getenv("SMTP_TLS_SERVER_NAME")),
		From:          from,
		FromName:      strings.TrimSpace(os.Getenv("EMAIL_FROM_NAME")),
	}
}
