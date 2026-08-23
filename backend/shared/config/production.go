package config

import (
	"fmt"
	"os"
	"strings"
)

// ValidateProductionEnv rejects obvious demo defaults when APP_ENV=production.
// Local/docker dev without APP_ENV=production is unaffected.
func ValidateProductionEnv() {
	if strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV"))) != "production" {
		return
	}

	jwt := os.Getenv("JWT_SECRET")
	internal := os.Getenv("INTERNAL_TOKEN")
	minioUser := os.Getenv("MINIO_ROOT_USER")
	minioPass := os.Getenv("MINIO_ROOT_PASSWORD")
	pgPass := os.Getenv("POSTGRES_PASSWORD")

	var problems []string
	if len(jwt) < 32 {
		problems = append(problems, "JWT_SECRET must be at least 32 characters in production")
	}
	if isWeakSecret(jwt, "dev-change-me", "dev-secret", "change-me") {
		problems = append(problems, "JWT_SECRET must not use a documented dev default in production")
	}
	if len(internal) < 16 {
		problems = append(problems, "INTERNAL_TOKEN must be at least 16 characters in production")
	}
	if isWeakSecret(internal, "dev-internal-token", "internal-token") {
		problems = append(problems, "INTERNAL_TOKEN must not use a documented dev default in production")
	}
	if minioUser == "minioadmin" || minioUser == "" {
		problems = append(problems, "MINIO_ROOT_USER must be set and must not be minioadmin in production")
	}
	if minioPass == "minioadmin" || len(minioPass) < 12 {
		problems = append(problems, "MINIO_ROOT_PASSWORD must be at least 12 characters and must not be minioadmin in production")
	}
	if pgPass == "postgres" || len(pgPass) < 12 {
		problems = append(problems, "POSTGRES_PASSWORD must be at least 12 characters and must not be postgres in production")
	}
	if os.Getenv("ALLOW_DEV_BILLING") == "true" {
		problems = append(problems, "ALLOW_DEV_BILLING must be false in production")
	}

	if len(problems) > 0 {
		panic(fmt.Sprintf("production env validation failed:\n- %s", strings.Join(problems, "\n- ")))
	}
}

func isWeakSecret(value string, blocked ...string) bool {
	v := strings.ToLower(strings.TrimSpace(value))
	for _, b := range blocked {
		if v == b || strings.Contains(v, b) {
			return true
		}
	}
	return false
}
