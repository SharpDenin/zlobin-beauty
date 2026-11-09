package service

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

// pushSender abstracts the HTTP push delivery for tests.
type pushSender interface {
	Send(ctx context.Context, sub domain.PushSubscription, payload []byte, publicKey, privateKey, subject string) (status int, bodySnippet string, err error)
}

// pushSubRepo is the subscription slice of the store (tests may inject a fake).
type pushSubRepo interface {
	ListPushSubscriptions(ctx context.Context, userID uuid.UUID) ([]domain.PushSubscription, error)
	DeletePushSubscription(ctx context.Context, userID uuid.UUID, endpoint string) error
}

type webPushSender struct{}

// pushTTLSeconds: how long the push service may retain the message while the
// device is offline. 60s (previous default) dropped salon notifications whenever
// the phone was briefly locked or offline — FCM/Mozilla discard expired messages.
const pushTTLSeconds = 86400

func (webPushSender) Send(ctx context.Context, sub domain.PushSubscription, payload []byte, publicKey, privateKey, subject string) (status int, bodySnippet string, err error) {
	resp, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		Subscriber:      subject,
		VAPIDPublicKey:  publicKey,
		VAPIDPrivateKey: privateKey,
		TTL:             pushTTLSeconds,
		Urgency:         webpush.UrgencyHigh,
	})
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()
	// Capture a short provider body for diagnostics (never log keys / full endpoint).
	snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode, strings.TrimSpace(string(snippet)), nil
}

// normalizeVAPIDSubject prepares Options.Subscriber for webpush-go.
// The library prepends "mailto:" unless the value already starts with "https:".
// Our docs historically used "mailto:…", which produced invalid JWT sub
// "mailto:mailto:…" and caused push providers to reject delivery.
func normalizeVAPIDSubject(subject string) string {
	subject = strings.TrimSpace(subject)
	if subject == "" {
		return "no-reply@salon-x.ru"
	}
	if strings.HasPrefix(subject, "https:") {
		return subject
	}
	subject = strings.TrimPrefix(subject, "mailto:")
	subject = strings.TrimSpace(subject)
	if subject == "" {
		return "no-reply@salon-x.ru"
	}
	return subject
}

func (s *Service) WithPush(publicKey, privateKey, subject string) *Service {
	s.vapidPublic = strings.TrimSpace(publicKey)
	s.vapidPrivate = strings.TrimSpace(privateKey)
	s.vapidSubject = normalizeVAPIDSubject(subject)
	if s.pushSender == nil {
		s.pushSender = webPushSender{}
	}
	if s.log == nil {
		s.log = slog.Default()
	}
	return s
}

func (s *Service) WithPushLogger(log *slog.Logger) *Service {
	if log != nil {
		s.log = log
	}
	return s
}

func (s *Service) PushEnabled() bool {
	return s.vapidPublic != "" && s.vapidPrivate != ""
}

func (s *Service) PushPublicKey() string {
	if !s.PushEnabled() {
		return ""
	}
	return s.vapidPublic
}

func (s *Service) SavePushSubscription(ctx context.Context, userID uuid.UUID, endpoint, p256dh, authKey string) error {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" || strings.TrimSpace(p256dh) == "" || strings.TrimSpace(authKey) == "" {
		return apperr.Validation("endpoint and keys are required")
	}
	return wrap(s.store.UpsertPushSubscription(ctx, domain.PushSubscription{
		ID: ids.New(), UserID: userID, Endpoint: endpoint, P256dh: p256dh, Auth: authKey, CreatedAt: time.Now().UTC(),
	}))
}

func (s *Service) RemovePushSubscription(ctx context.Context, userID uuid.UUID, endpoint string) error {
	return wrap(s.store.DeletePushSubscription(ctx, userID, strings.TrimSpace(endpoint)))
}

func notificationTarget(entityType string, entityID *uuid.UUID) string {
	if entityID == nil {
		return "/notifications"
	}
	switch entityType {
	case "appointment":
		return "/appointments/" + entityID.String()
	case "conversation":
		return "/messages/" + entityID.String()
	case "masterclass":
		return "/masterclasses/" + entityID.String()
	case "model_request":
		return "/models/" + entityID.String()
	case "client_order":
		return "/orders/" + entityID.String()
	case "hair_consultation":
		return "/consultations/" + entityID.String()
	default:
		return "/notifications"
	}
}

// schedulePush delivers Web Push after the in-app notification is persisted.
// Failures never affect CreateNotification; work runs off the request path.
func (s *Service) schedulePush(userID uuid.UUID, title, body, entityType string, entityID *uuid.UUID) {
	if !s.PushEnabled() {
		return
	}
	var entityCopy *uuid.UUID
	if entityID != nil {
		id := *entityID
		entityCopy = &id
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		s.dispatchPush(ctx, userID, title, body, entityType, entityCopy)
	}()
}

func (s *Service) dispatchPush(ctx context.Context, userID uuid.UUID, title, body, entityType string, entityID *uuid.UUID) {
	if !s.PushEnabled() {
		return
	}
	repo := s.pushSubs
	if repo == nil {
		repo = s.store
	}
	subs, err := repo.ListPushSubscriptions(ctx, userID)
	if err != nil {
		if s.log != nil {
			s.log.Warn("push list subscriptions failed",
				"user_id", userID.String(),
				"entity_type", entityType,
				"err", err.Error())
		}
		return
	}
	if len(subs) == 0 {
		if s.log != nil {
			s.log.Info("push skipped: no subscriptions",
				"user_id", userID.String(),
				"entity_type", entityType)
		}
		return
	}
	payload, err := json.Marshal(map[string]string{
		"title": title,
		"body":  body,
		"url":   notificationTarget(entityType, entityID),
	})
	if err != nil {
		if s.log != nil {
			s.log.Warn("push payload marshal failed",
				"user_id", userID.String(),
				"entity_type", entityType,
				"err", err.Error())
		}
		return
	}
	sender := s.pushSender
	if sender == nil {
		sender = webPushSender{}
	}
	sent, failed, pruned := 0, 0, 0
	for _, sub := range subs {
		host := pushEndpointHost(sub.Endpoint)
		status, snippet, err := sender.Send(ctx, sub, payload, s.vapidPublic, s.vapidPrivate, s.vapidSubject)
		if err != nil {
			failed++
			if s.log != nil {
				s.log.Warn("push delivery failed",
					"user_id", userID.String(),
					"entity_type", entityType,
					"endpoint_host", host,
					"err", err.Error())
			}
			continue
		}
		if status == http.StatusGone || status == http.StatusNotFound {
			pruned++
			_ = repo.DeletePushSubscription(ctx, userID, sub.Endpoint)
			if s.log != nil {
				s.log.Info("push subscription pruned",
					"user_id", userID.String(),
					"endpoint_host", host,
					"http_status", status)
			}
			continue
		}
		if status == http.StatusUnauthorized || status == http.StatusForbidden {
			failed++
			if s.log != nil {
				s.log.Warn("push delivery rejected: check VAPID key pair matches subscription",
					"user_id", userID.String(),
					"entity_type", entityType,
					"endpoint_host", host,
					"http_status", status,
					"provider_body", truncatePushDiag(snippet, 160))
			}
			continue
		}
		if status >= 400 {
			failed++
			if s.log != nil {
				s.log.Warn("push delivery rejected",
					"user_id", userID.String(),
					"entity_type", entityType,
					"endpoint_host", host,
					"http_status", status,
					"provider_body", truncatePushDiag(snippet, 160))
			}
			continue
		}
		sent++
	}
	if s.log != nil {
		s.log.Info("push dispatch finished",
			"user_id", userID.String(),
			"entity_type", entityType,
			"subscriptions", len(subs),
			"sent", sent,
			"failed", failed,
			"pruned", pruned)
	}
}

func truncatePushDiag(s string, max int) string {
	s = strings.TrimSpace(s)
	if s == "" || max <= 0 {
		return ""
	}
	// Strip control chars so logs stay single-line and safe.
	s = strings.Map(func(r rune) rune {
		if r < 32 {
			return -1
		}
		return r
	}, s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

func pushEndpointHost(endpoint string) string {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return ""
	}
	// Avoid logging full endpoint paths (contain device tokens).
	if i := strings.Index(endpoint, "://"); i >= 0 {
		rest := endpoint[i+3:]
		if j := strings.IndexByte(rest, '/'); j >= 0 {
			return rest[:j]
		}
		return rest
	}
	return ""
}
