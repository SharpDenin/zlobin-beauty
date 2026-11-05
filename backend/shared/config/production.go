package config

import (
 "fmt"
 "os"
 "strings"
)

// ValidateProductionEnv checks production environment configuration.
// Local/docker dev without APP_ENV=production is unaffected.
func ValidateProductionEnv() {
 if strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV"))) != "production" {
  return
 }

 jwt := os.Getenv("JWT_SECRET")
 internal := os.Getenv("INTERNAL_TOKEN")

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

 if os.Getenv("ALLOW_DEV_BILLING") == "true" {
  problems = append(problems, "ALLOW_DEV_BILLING must be false in production")
 }

 if strings.TrimSpace(os.Getenv("CORS_ORIGINS")) == "*" {
  problems = append(problems, "CORS_ORIGINS must not be * in production")
 }

 if len(problems) > 0 {
  panic(fmt.Sprintf(
   "production env validation failed:\n- %s",
   strings.Join(problems, "\n- "),
  ))
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