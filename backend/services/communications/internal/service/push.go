package service

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

func (s *Service) WithPush(publicKey, privateKey, subject string) *Service {
	s.vapidPublic = strings.TrimSpace(publicKey)
	s.vapidPrivate = strings.TrimSpace(privateKey)
	s.vapidSubject = strings.TrimSpace(subject)
	if s.vapidSubject == "" {
		s.vapidSubject = "mailto:support@salonx.local"
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

func (s *Service) dispatchPush(ctx context.Context, userID uuid.UUID, title, body, entityType string, entityID *uuid.UUID) {
	if !s.PushEnabled() {
		return
	}
	subs, err := s.store.ListPushSubscriptions(ctx, userID)
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
	for _, sub := range subs {
		resp, err := webpush.SendNotification(payload, &webpush.Subscription{
			Endpoint: sub.Endpoint,
			Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
		}, &webpush.Options{
			Subscriber:      s.vapidSubject,
			VAPIDPublicKey:  s.vapidPublic,
			VAPIDPrivateKey: s.vapidPrivate,
			TTL:             60,
		})
		if err != nil {
			log.Printf("push send: %v", err)
			continue
		}
		if resp != nil && resp.Body != nil {
			_ = resp.Body.Close()
		}
		if resp != nil && (resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound) {
			_ = s.store.DeletePushSubscription(ctx, userID, sub.Endpoint)
		}
	}
}
