package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/httpapi"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/services/identity/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/auth"
	"github.com/zlobin/zlobin-beauty/backend/shared/config"
	"github.com/zlobin/zlobin-beauty/backend/shared/db"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
	"github.com/zlobin/zlobin-beauty/backend/shared/logging"
	"github.com/zlobin/zlobin-beauty/backend/shared/mailer"
)

func main() {
	cfg := config.MustBase("identity")
	if cfg.JWTSecret == "" {
		panic("JWT_SECRET is required")
	}
	log := logging.New(cfg.ServiceName, cfg.LogLevel)

	ctx := context.Background()
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("db connect", "error", err)
		os.Exit(1)
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
		log.Error("migrate", "error", err)
		os.Exit(1)
	}

	auth.ConfigureTTLs(config.EnvDuration("ACCESS_TOKEN_TTL", auth.AccessTTL), config.EnvDuration("REFRESH_TOKEN_TTL", auth.RefreshTTL))
	st := store.New(pool)
	allowDev := os.Getenv("ALLOW_DEV_BILLING") == "true" || os.Getenv("APP_ENV") == "development" || os.Getenv("APP_ENV") == ""
	ml := mailer.NewFromEnv()
	if !ml.Ready() {
		log.Warn("mailer not configured: password reset and email verification emails will not be sent until SMTP_PASSWORD (and related vars) are set")
	} else {
		log.Info("mailer ready", "provider", os.Getenv("EMAIL_PROVIDER"), "host", os.Getenv("SMTP_HOST"))
	}
	svc := service.New(st, cfg.JWTSecret).
		WithDevBilling(allowDev).
		WithMedia(os.Getenv("MEDIA_URL"), os.Getenv("INTERNAL_TOKEN")).
		WithAccountDeleteDeps(
			os.Getenv("ORGANIZATIONS_URL"),
			os.Getenv("COMMUNICATIONS_URL"),
			os.Getenv("MARKETPLACE_URL"),
			os.Getenv("INTERNAL_TOKEN"),
		).
		WithMailer(ml).
		WithPublicAppURL(firstNonEmpty(os.Getenv("PUBLIC_APP_URL"), os.Getenv("APP_PUBLIC_URL"))).
		WithLogger(log)
	api := httpapi.New(svc, log)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", httpx.Healthz)
	mux.HandleFunc("GET /readyz", httpx.Readyz(st.Ping))
	api.Routes(mux, cfg.JWTSecret)
	api.InternalRoutes(mux, os.Getenv("INTERNAL_TOKEN"))

	handler := httpx.WithRequestID(
		httpx.SecurityHeaders(
			httpx.CORS(cfg.CORSOrigins)(
				httpx.MaxBytes(1 << 20)(
					httpx.AccessLog(log)(mux),
				),
			),
		),
	)

	srv := &http.Server{Addr: cfg.HTTPAddr, Handler: handler, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		log.Info("listening", "addr", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("serve", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
