package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type Service struct {
	store      *store.Store
	bookingURL string
	httpClient *http.Client
	now        func() time.Time
}

func New(st *store.Store, bookingURL string) *Service {
	return &Service{
		store: st, bookingURL: strings.TrimRight(bookingURL, "/"),
		httpClient: &http.Client{Timeout: 5 * time.Second}, now: time.Now,
	}
}

func (s *Service) CreateNotification(ctx context.Context, userID uuid.UUID, typ, title, body, entityType string, entityID *uuid.UUID) error {
	return wrap(s.store.CreateNotification(ctx, domain.Notification{
		ID: ids.New(), UserID: userID, Type: typ, Title: title, Body: body, EntityType: entityType, EntityID: entityID, CreatedAt: s.now().UTC(),
	}))
}

func (s *Service) List(ctx context.Context, userID uuid.UUID) ([]domain.Notification, error) {
	items, err := s.store.ListNotifications(ctx, userID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.Notification{}
	}
	return items, nil
}

func (s *Service) MarkRead(ctx context.Context, id, userID uuid.UUID) error {
	err := s.store.MarkRead(ctx, id, userID, s.now().UTC())
	if ae, ok := apperr.As(err); ok {
		return ae
	}
	if err != nil {
		return apperr.Internal(err)
	}
	return nil
}

type CreateReviewInput struct {
	AppointmentID  uuid.UUID
	ActorID        uuid.UUID
	AuthHeader     string
	MasterRating   int
	ResultRating   int
	Comment        string
	PublishAllowed bool
}

func (s *Service) CreateReview(ctx context.Context, in CreateReviewInput) (*domain.Review, error) {
	if in.MasterRating < 1 || in.MasterRating > 5 || in.ResultRating < 1 || in.ResultRating > 5 {
		return nil, apperr.Validation("ratings must be 1-5")
	}
	if s.bookingURL == "" {
		return nil, apperr.Internal(fmt.Errorf("BOOKING_URL is not configured"))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.bookingURL+"/v1/appointments/"+in.AppointmentID.String(), nil)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if in.AuthHeader != "" {
		req.Header.Set("Authorization", in.AuthHeader)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusNotFound {
		return nil, apperr.NotFound("appointment not found")
	}
	if resp.StatusCode >= 300 {
		return nil, apperr.Internal(fmt.Errorf("booking status %d", resp.StatusCode))
	}
	var appt struct {
		Status       string `json:"status"`
		ClientUserID string `json:"client_user_id"`
		MasterUserID string `json:"master_user_id"`
	}
	if err := json.Unmarshal(body, &appt); err != nil {
		return nil, apperr.Internal(err)
	}
	if appt.Status != "completed" {
		return nil, apperr.Conflict("review allowed only after completed visit")
	}
	if appt.ClientUserID != in.ActorID.String() {
		return nil, apperr.Forbidden("only client can review")
	}
	masterID, err := uuid.Parse(appt.MasterUserID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	r := domain.Review{
		ID: ids.New(), AppointmentID: in.AppointmentID, ClientUserID: in.ActorID, MasterUserID: masterID,
		MasterRating: in.MasterRating, ResultRating: in.ResultRating, Comment: strings.TrimSpace(in.Comment),
		PublishAllowed: in.PublishAllowed, CreatedAt: s.now().UTC(),
	}
	if err := s.store.CreateReview(ctx, r); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return &r, nil
}

func (s *Service) ListMine(ctx context.Context, userID uuid.UUID) ([]domain.Review, error) {
	items, err := s.store.ListReviewsByClient(ctx, userID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.Review{}
	}
	return items, nil
}

func (s *Service) ListMasterPublic(ctx context.Context, masterID uuid.UUID) ([]domain.Review, error) {
	items, err := s.store.ListPublicByMaster(ctx, masterID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.Review{}
	}
	return items, nil
}

func (s *Service) ReviewStats(ctx context.Context, masterIDs []uuid.UUID, from, to time.Time) (*store.ReviewStats, error) {
	if !to.After(from) {
		return nil, apperr.Validation("to must be after from")
	}
	stats, err := s.store.ReviewStatsForMasters(ctx, masterIDs, from.UTC(), to.UTC())
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return stats, nil
}

func wrap(err error) error {
	if err != nil {
		return apperr.Internal(err)
	}
	return nil
}
