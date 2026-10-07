package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/zlobin/zlobin-beauty/backend/shared/config"
	"github.com/zlobin/zlobin-beauty/backend/shared/httpx"
	"github.com/zlobin/zlobin-beauty/backend/shared/logging"
)

func main() {
	config.ValidateProductionEnv()
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
	clients := mustProxy(getenv("CLIENTS_URL", "http://clients:8080"))
	communications := mustProxy(getenv("COMMUNICATIONS_URL", "http://communications:8080"))
	commerce := mustProxy(getenv("COMMERCE_URL", "http://commerce:8080"))
	media := mustProxy(getenv("MEDIA_URL", "http://media:8080"))

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", httpx.Healthz)
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, _ *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})

	mux.Handle("/v1/auth/", identity)
	mux.Handle("/v1/me/subscription", identity)
	mux.Handle("/v1/me/subscription/", identity)
	mux.Handle("/v1/me/dashboard", identity)
	mux.Handle("/v1/me/hints", identity)
	mux.Handle("/v1/me/preferences", identity)
	mux.Handle("/v1/me/preferences/", identity)
	// /v1/internal/* is service-to-service only and is deliberately NOT routed through the edge.
	mux.Handle("/v1/internal/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	mux.Handle("/v1/admin/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		switch {
		case p == "/v1/admin/stats" || strings.HasPrefix(p, "/v1/admin/users") || strings.HasPrefix(p, "/v1/admin/audit-log"):
			identity.ServeHTTP(w, r)
		case strings.HasPrefix(p, "/v1/admin/organizations") || strings.HasPrefix(p, "/v1/admin/suppliers"):
			organizations.ServeHTTP(w, r)
		case strings.HasPrefix(p, "/v1/admin/masters") || strings.HasPrefix(p, "/v1/admin/services") || strings.HasPrefix(p, "/v1/admin/knowledge") || strings.HasPrefix(p, "/v1/admin/profession-types"):
			marketplace.ServeHTTP(w, r)
		case strings.HasPrefix(p, "/v1/admin/products") || strings.HasPrefix(p, "/v1/admin/orders"):
			commerce.ServeHTTP(w, r)
		case strings.HasPrefix(p, "/v1/admin/appointments") || strings.HasPrefix(p, "/v1/admin/working-hours"):
			booking.ServeHTTP(w, r)
		case strings.HasPrefix(p, "/v1/admin/disputes"):
			clients.ServeHTTP(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	mux.Handle("/v1/me/representative", organizations)
	mux.Handle("/v1/tasks/", organizations)
	mux.Handle("/v1/organizations", organizations)
	mux.Handle("/v1/organizations/", organizations)
	mux.Handle("/v1/branches", organizations)
	mux.Handle("/v1/branches/", organizations)
	mux.Handle("/v1/suppliers", organizations)
	mux.Handle("/v1/suppliers/", organizations)
	mux.Handle("/v1/me/master", marketplace)
	mux.Handle("/v1/me/master/", marketplace)
	mux.Handle("/v1/me/model-preferences", clients)
	mux.Handle("/v1/masterclasses", marketplace)
	mux.Handle("/v1/masterclasses/", marketplace)
	mux.Handle("/v1/masterclass-interests", marketplace)
	mux.Handle("/v1/masterclass-interests/", marketplace)
	mux.Handle("/v1/masterclass-registrations/", marketplace)
	mux.Handle("/v1/model-requests", marketplace)
	mux.Handle("/v1/model-requests/", marketplace)
	mux.Handle("/v1/model-responses/", marketplace)
	mux.Handle("/v1/profession-types", marketplace)
	mux.Handle("/v1/profession-types/", marketplace)
	mux.Handle("/v1/services", marketplace)
	mux.Handle("/v1/services/", marketplace)
	mux.Handle("/v1/occurrences", marketplace)
	mux.Handle("/v1/occurrences/", marketplace)
	mux.Handle("/v1/service-categories", marketplace)
	mux.Handle("/v1/service-categories/", marketplace)
	mux.Handle("/v1/knowledge", marketplace)
	mux.Handle("/v1/knowledge/", marketplace)
	mux.Handle("/v1/me/knowledge", marketplace)
	mux.Handle("/v1/me/knowledge/", marketplace)
	mux.Handle("/v1/me/inventory", commerce)
	mux.Handle("/v1/me/inventory/", commerce)
	mux.Handle("/v1/me/working-hours", booking)
	mux.Handle("/v1/me/schedule-exceptions", booking)
	mux.Handle("/v1/me/work-mode-intervals", booking)
	mux.Handle("/v1/me/work-mode-intervals/", booking)
	mux.Handle("/v1/me/usable-chairs", booking)
	mux.Handle("/v1/me/chair-leases", booking)
	mux.Handle("/v1/geo/", booking)
	mux.Handle("/v1/chairs", booking)
	mux.Handle("/v1/chairs/", booking)
	mux.Handle("/v1/chair-leases", booking)
	mux.Handle("/v1/chair-leases/", booking)
	mux.Handle("/v1/me/clients/", booking)
	mux.Handle("/v1/appointments", booking)
	mux.Handle("/v1/appointments/", booking)
	mux.Handle("/v1/reports/", booking)
	mux.Handle("/v1/clients", clients)
	mux.Handle("/v1/clients/", clients)
	mux.Handle("/v1/client-cards", clients)
	mux.Handle("/v1/client-cards/", clients)
	mux.Handle("/v1/notifications", communications)
	mux.Handle("/v1/notifications/", communications)
	mux.Handle("/v1/push/", communications)
	mux.Handle("/v1/conversations", communications)
	mux.Handle("/v1/conversations/", communications)
	mux.Handle("/v1/contacts", communications)
	mux.Handle("/v1/contacts/", communications)
	mux.Handle("/v1/invites", organizations)
	mux.Handle("/v1/invites/", organizations)
	mux.Handle("/v1/reviews", communications)
	mux.Handle("/v1/reviews/", communications)
	mux.Handle("/v1/commerce/", commerce)
	mux.Handle("/v1/planner", booking)
	mux.Handle("/v1/planner/", booking)
	mux.Handle("/v1/calendar/", booking)
	mux.Handle("/v1/media", media)
	mux.Handle("/v1/media/", media)
	mux.Handle("/v1/masters", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		marketplace.ServeHTTP(w, r)
	}))
	mux.Handle("/v1/masters/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/reviews") {
			communications.ServeHTTP(w, r)
			return
		}
		if strings.Contains(r.URL.Path, "/slots") {
			booking.ServeHTTP(w, r)
			return
		}
		marketplace.ServeHTTP(w, r)
	}))

	// Order (outermost first): request id -> panic guard -> security headers -> CORS -> rate limit ->
	// per-request deadlines -> body limit -> access log -> routes. Server-wide Read/WriteTimeout are
	// disabled on purpose: they kill slow mobile uploads; httpx.Deadlines applies per-route budgets.
	handler := httpx.WithRequestID(
		recoverPanics(
			httpx.SecurityHeaders(
				httpx.CORS(corsOrigins)(
					rateLimit()(
						httpx.Deadlines(30*time.Second, 60*time.Second, edgeDeadlines)(
							bodyLimit(
								httpx.AccessLog(log)(mux),
							),
						),
					),
				),
			),
		),
	)

	srv := &http.Server{
		Addr: addr, Handler: handler,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
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
