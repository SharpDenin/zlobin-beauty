package main

import (
	"context"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
	"github.com/zlobin/zlobin-beauty/backend/shared/logging"
)

func main() {
	addr := getenv("HTTP_ADDR", ":8080")
	if os.Getenv("JWT_SECRET") == "" {
		panic("JWT_SECRET is required")
	}
	log := logging.New("gateway", getenv("LOG_LEVEL", "info"))
	corsOrigins := splitCSV(getenv("CORS_ORIGINS", "http://localhost:5173"))

	identity := mustProxy(getenv("IDENTITY_URL", "http://identity:8080"))
	organizations := mustProxy(getenv("ORGANIZATIONS_URL", "http://organizations:8080"))
	marketplace := mustProxy(getenv("MARKETPLACE_URL", "http://marketplace:8080"))
	booking := mustProxy(getenv("BOOKING_URL", "http://booking:8080"))

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", httpx.Healthz)
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, _ *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})

	mux.Handle("/v1/auth/", identity)
	mux.Handle("/v1/organizations", organizations)
	mux.Handle("/v1/organizations/", organizations)
	mux.Handle("/v1/branches/", organizations)
	mux.Handle("/v1/me/master", marketplace)
	mux.Handle("/v1/services", marketplace)
	mux.Handle("/v1/services/", marketplace)
	mux.Handle("/v1/me/working-hours", booking)
	mux.Handle("/v1/appointments", booking)
	mux.Handle("/v1/appointments/", booking)
	mux.Handle("/v1/masters", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		marketplace.ServeHTTP(w, r)
	}))
	mux.Handle("/v1/masters/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/slots") {
			booking.ServeHTTP(w, r)
			return
		}
		marketplace.ServeHTTP(w, r)
	}))

	handler := httpx.WithRequestID(
		httpx.SecurityHeaders(
			httpx.CORS(corsOrigins)(
				httpx.MaxBytes(1<<20)(
					httpx.AccessLog(log)(mux),
				),
			),
		),
	)

	srv := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		log.Info("listening", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("serve", "error", err)
			os.Exit(1)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

func mustProxy(raw string) http.Handler {
	u, err := url.Parse(raw)
	if err != nil {
		panic(err)
	}
	p := httputil.NewSingleHostReverseProxy(u)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Host = u.Host
		p.ServeHTTP(w, r)
	})
}

func getenv(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
