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

	"github.com/zlobin/zlobin-beauty/backend/services/media/internal/httpapi"
	"github.com/zlobin/zlobin-beauty/backend/services/media/internal/service"
	"github.com/zlobin/zlobin-beauty/backend/services/media/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/config"
	"github.com/zlobin/zlobin-beauty/backend/shared/db"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
	"github.com/zlobin/zlobin-beauty/backend/shared/logging"
)

func main() {
	cfg := config.MustBase("media")
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
		migDir = filepath.Join("services", "media", "migrations")
		if _, err := os.Stat(migDir); err != nil {
			migDir = "migrations"
		}
	}
	if err := db.Migrate(ctx, pool, migDir); err != nil {
		log.Error("migrate", "error", err)
		os.Exit(1)
	}
	storage, err := service.NewObjectStorage(ctx, service.StorageConfig{
		Endpoint:  getenv("MINIO_ENDPOINT", "localhost:9000"),
		AccessKey: getenv("MINIO_ACCESS_KEY", "minioadmin"),
		SecretKey: getenv("MINIO_SECRET_KEY", "minioadmin"),
		Bucket:    getenv("MINIO_BUCKET", "zlobin-media"),
		UseSSL:    config.EnvBool("MINIO_USE_SSL", false),
	})
	if err != nil {
		log.Error("storage", "error", err)
		os.Exit(1)
	}
	st := store.New(pool)
	svc := service.New(st, storage).
		WithCommunications(getenv("COMMUNICATIONS_URL", "http://communications:8080"), os.Getenv("INTERNAL_TOKEN")).
		WithBooking(getenv("BOOKING_URL", "http://booking:8080")).
		WithSigningSecret(cfg.JWTSecret)
	api := httpapi.New(svc, log, os.Getenv("INTERNAL_TOKEN"))
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", httpx.Healthz)
	mux.HandleFunc("GET /readyz", httpx.Readyz(st.Ping))
	api.Routes(mux, cfg.JWTSecret)
	// Uploads and video streaming need minutes on mobile links; server-wide timeouts are disabled
	// and replaced by per-request deadlines (see httpx.Deadlines).
	handler := httpx.WithRequestID(
		httpx.SecurityHeaders(
			httpx.CORS(cfg.CORSOrigins)(
				httpx.Deadlines(30*time.Second, 60*time.Second, mediaDeadlines)(
					httpx.AccessLog(log)(mux),
				),
			),
		),
	)
	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
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

// mediaDeadlines gives uploads and content streaming the time a slow phone connection needs.
func mediaDeadlines(r *http.Request) (read, write time.Duration, ok bool) {
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/v1/media":
		return 10 * time.Minute, 10 * time.Minute, true
	case strings.HasSuffix(r.URL.Path, "/content"):
		return 30 * time.Second, 30 * time.Minute, true
	}
	return 0, 0, false
}

func getenv(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
