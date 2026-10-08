package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/httpapi"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/config"
	"github.com/zlobin/zlobin-beauty/backend/shared/db"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
	"github.com/zlobin/zlobin-beauty/backend/shared/logging"
)

func main() {
	cfg := config.MustBase("communications")
	if cfg.JWTSecret == "" {
		panic("JWT_SECRET is required")
	}
	bookingURL := getenv("BOOKING_URL", "http://booking:8080")
	log := logging.New(cfg.ServiceName, cfg.LogLevel)
	ctx := context.Background()
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("db", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	migDir := os.Getenv("MIGRATIONS_DIR")
	if migDir == "" {
		migDir = filepath.Join("services", "communications", "migrations")
		if _, err := os.Stat(migDir); err != nil {
			migDir = "migrations"
		}
	}
	if err := db.Migrate(ctx, pool, migDir); err != nil {
		log.Error("migrate", "error", err)
		os.Exit(1)
	}
	st := store.New(pool)
	svc := service.New(st, bookingURL).WithMessenger(service.MessengerDeps{
		IdentityURL:      getenv("IDENTITY_URL", "http://identity:8080"),
		OrganizationsURL: getenv("ORGANIZATIONS_URL", "http://organizations:8080"),
		MarketplaceURL:   getenv("MARKETPLACE_URL", "http://marketplace:8080"),
		MediaURL:         getenv("MEDIA_URL", "http://media:8080"),
		InternalToken:    os.Getenv("INTERNAL_TOKEN"),
	}).WithPush(os.Getenv("VAPID_PUBLIC_KEY"), os.Getenv("VAPID_PRIVATE_KEY"), os.Getenv("VAPID_SUBJECT"))
	api := httpapi.New(svc, log, os.Getenv("INTERNAL_TOKEN"))
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", httpx.Healthz)
	mux.HandleFunc("GET /readyz", httpx.Readyz(st.Ping))
	api.Routes(mux, cfg.JWTSecret)
	handler := httpx.WithRequestID(httpx.SecurityHeaders(httpx.CORS(cfg.CORSOrigins)(httpx.MaxBytes(1 << 20)(httpx.AccessLog(log)(mux)))))
	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
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
	cctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(cctx)
}

func getenv(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
