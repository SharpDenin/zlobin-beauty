package config

import (
	"strings"
	"testing"
)

func TestValidateProductionEnv_skipsNonProduction(t *testing.T) {
	t.Setenv("APP_ENV", "demo")
	t.Setenv("JWT_SECRET", "dev-change-me")
	ValidateProductionEnv()
}

func TestValidateProductionEnv_rejectsWeakSecrets(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("JWT_SECRET", "dev-change-me")
	t.Setenv("INTERNAL_TOKEN", "dev-internal-token")
	t.Setenv("MINIO_ROOT_USER", "minioadmin")
	t.Setenv("MINIO_ROOT_PASSWORD", "minioadmin")
	t.Setenv("POSTGRES_PASSWORD", "postgres")
	t.Setenv("ALLOW_DEV_BILLING", "false")

	defer func() {
		if recover() == nil {
			t.Fatal("expected panic for weak production secrets")
		}
	}()
	ValidateProductionEnv()
}

func TestValidateProductionEnv_acceptsStrongSecrets(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("JWT_SECRET", strings.Repeat("a", 32))
	t.Setenv("INTERNAL_TOKEN", strings.Repeat("b", 16))
	t.Setenv("MINIO_ROOT_USER", "salonx-minio")
	t.Setenv("MINIO_ROOT_PASSWORD", strings.Repeat("c", 12))
	t.Setenv("POSTGRES_PASSWORD", strings.Repeat("d", 12))
	t.Setenv("ALLOW_DEV_BILLING", "false")
	ValidateProductionEnv()
}
