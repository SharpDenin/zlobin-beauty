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
	Send(ctx context.Context, sub domain.PushSubscription, payload []byte, publicKey, privateKey, subject string) (status int, err error)
}

// pushSubRepo is the subscription slice of the store (tests may inject a fake).
type pushSubRepo interface {
	ListPushSubscriptions(ctx context.Context, userID uuid.UUID) ([]domain.PushSubscription, error)
	DeletePushSubscription(ctx context.Context, userID uuid.UUID, endpoint string) error
}

type webPushSender struct{}

func (webPushSender) Send(ctx context.Context, sub domain.PushSubscription, payload []byte, publicKey, privateKey, subject string) (int, error) {
	resp, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		Subscriber:      subject,
		VAPIDPublicKey:  publicKey,
		VAPIDPrivateKey: privateKey,
		TTL:             60,
	})
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode, nil
}

func (s *Service) WithPush(publicKey, privateKey, subject string) *Service {
	s.vapidPublic = strings.TrimSpace(publicKey)
	s.vapidPrivate = strings.TrimSpace(privateKey)
	s.vapidSubject = strings.TrimSpace(subject)
	if s.vapidSubject == "" {
		s.vapidSubject = "mailto:no-reply@salon-x.ru"
	}
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
	if err != nil || len(subs) == 0 {
		return
	}
	payload, err := json.Marshal(map[string]string{
		"title": title,
		"body":  body,
		"url":   notificationTarget(entityType, entityID),
	})
	if err != nil {
		return
	}
	sender := s.pushSender
	if sender == nil {
		sender = webPushSender{}
	}
	for _, sub := range subs {
		status, err := sender.Send(ctx, sub, payload, s.vapidPublic, s.vapidPrivate, s.vapidSubject)
		if err != nil {
			if s.log != nil {
				s.log.Warn("push delivery failed", "status", "error")
			}
			continue
		}
		if status == http.StatusGone || status == http.StatusNotFound {
			_ = repo.DeletePushSubscription(ctx, userID, sub.Endpoint)
			continue
		}
		if status >= 500 && s.log != nil {
			s.log.Warn("push delivery temporary failure", "http_status", status)
		}
	}
}
