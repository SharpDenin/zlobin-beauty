package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/httpapi"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/config"
	"github.com/zlobin/zlobin-beauty/backend/shared/db"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
	"github.com/zlobin/zlobin-beauty/backend/shared/logging"
)

func main() {
	cfg := config.MustBase("organizations")
	if cfg.JWTSecret == "" {
		panic("JWT_SECRET is required")
	}
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
		migDir = filepath.Join("services", "organizations", "migrations")
		if _, err := os.Stat(migDir); err != nil {
			migDir = "migrations"
		}
	}
	if err := db.Migrate(ctx, pool, migDir); err != nil {
		log.Error("migrate", "error", err)
		os.Exit(1)
	}
	st := store.New(pool)
	api := httpapi.New(service.New(st), log, os.Getenv("INTERNAL_TOKEN"))
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", httpx.Healthz)
	mux.HandleFunc("GET /readyz", httpx.Readyz(st.Ping))
	api.Routes(mux, cfg.JWTSecret)
	handler := httpx.WithRequestID(httpx.SecurityHeaders(httpx.CORS(cfg.CORSOrigins)(httpx.MaxBytes(1 << 20)(httpx.AccessLog(log)(mux)))))
	srv := &http.Server{
		Addr: cfg.HTTPAddr, Handler: handler,
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second,
		WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second,
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
