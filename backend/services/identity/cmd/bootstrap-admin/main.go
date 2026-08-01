package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/db"
	"github.com/zlobin/zlobin-beauty/backend/shared/logging"
)

func main() {
	log := logging.New("bootstrap-admin", "info")
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		fatal(log, "DATABASE_URL is required")
	}
	email := os.Getenv("BOOTSTRAP_ADMIN_EMAIL")
	password := os.Getenv("BOOTSTRAP_ADMIN_PASSWORD")
	name := os.Getenv("BOOTSTRAP_ADMIN_NAME")

	ctx := context.Background()
	pool, err := db.Connect(ctx, databaseURL)
	if err != nil {
		fatal(log, err.Error())
	}
	defer pool.Close()

	migDir := os.Getenv("MIGRATIONS_DIR")
	if migDir == "" {
		migDir = filepath.Join("services", "identity", "migrations")
		if _, err := os.Stat(migDir); err != nil {
			migDir = "migrations"
		}
	}
	if err := db.Migrate(ctx, pool, migDir); err != nil {
		fatal(log, err.Error())
	}

	svc := service.New(store.New(pool), os.Getenv("JWT_SECRET"))
	user, err := svc.BootstrapAdmin(ctx, email, password, name)
	if err != nil {
		fatal(log, err.Error())
	}
	fmt.Printf("bootstrap admin created id=%s email=%s\n", user.ID, email)
}

func fatal(log interface{ Error(string, ...any) }, msg string) {
	log.Error(msg)
	os.Exit(1)
}
