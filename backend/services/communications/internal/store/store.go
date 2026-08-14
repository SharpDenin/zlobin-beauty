package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

type Store struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Store             { return &Store{pool: pool} }
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

func (s *Store) CreateNotification(ctx context.Context, n domain.Notification) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO notifications(id, user_id, type, title, body, entity_type, entity_id, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, n.ID, n.UserID, n.Type, n.Title, n.Body, n.EntityType, n.EntityID, n.CreatedAt)
	return err
}

func (s *Store) ListNotifications(ctx context.Context, userID uuid.UUID) ([]domain.Notification, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, user_id, type, title, body, entity_type, entity_id, read_at, created_at
FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Notification
	for rows.Next() {
		var n domain.Notification
		if err := rows.Scan(&n.ID, &n.UserID, &n.Type, &n.Title, &n.Body, &n.EntityType, &n.EntityID, &n.ReadAt, &n.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (s *Store) MarkRead(ctx context.Context, id, userID uuid.UUID, at time.Time) error {
	tag, err := s.pool.Exec(ctx, `UPDATE notifications SET read_at=$3 WHERE id=$1 AND user_id=$2 AND read_at IS NULL`, id, userID, at)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("notification not found")
	}
	return nil
}

func (s *Store) CreateReview(ctx context.Context, r domain.Review) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO reviews(id, appointment_id, client_user_id, master_user_id, master_rating, result_rating, comment, publish_allowed, hidden, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		r.ID, r.AppointmentID, r.ClientUserID, r.MasterUserID, r.MasterRating, r.ResultRating, r.Comment, r.PublishAllowed, r.Hidden, r.CreatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return apperr.Conflict("review already exists")
		}
		return err
	}
	return nil
}

func (s *Store) ListReviewsByClient(ctx context.Context, clientID uuid.UUID) ([]domain.Review, error) {
	return s.scanReviews(ctx, `SELECT id, appointment_id, client_user_id, master_user_id, master_rating, result_rating, comment, publish_allowed, hidden, created_at FROM reviews WHERE client_user_id=$1 ORDER BY created_at DESC`, clientID)
}

func (s *Store) ListPublicByMaster(ctx context.Context, masterID uuid.UUID) ([]domain.Review, error) {
	return s.scanReviews(ctx, `SELECT id, appointment_id, client_user_id, master_user_id, master_rating, result_rating, comment, publish_allowed, hidden, created_at FROM reviews WHERE master_user_id=$1 AND publish_allowed=TRUE AND hidden=FALSE ORDER BY created_at DESC`, masterID)
}

type ReviewStats struct {
	Avg   *float64
	Count int64
}

func (s *Store) ReviewStatsForMasters(ctx context.Context, masterIDs []uuid.UUID, from, to time.Time) (*ReviewStats, error) {
	if len(masterIDs) == 0 {
		return &ReviewStats{Count: 0}, nil
	}
	row := s.pool.QueryRow(ctx, `
SELECT AVG((master_rating + result_rating)::float / 2), COUNT(*)::bigint
FROM reviews
WHERE master_user_id = ANY($1)
  AND publish_allowed = TRUE
  AND hidden = FALSE
  AND created_at >= $2 AND created_at < $3`, masterIDs, from, to)
	var avg *float64
	var count int64
	if err := row.Scan(&avg, &count); err != nil {
		return nil, err
	}
	if count == 0 {
		avg = nil
	}
	return &ReviewStats{Avg: avg, Count: count}, nil
}

func (s *Store) scanReviews(ctx context.Context, q string, arg any) ([]domain.Review, error) {
	rows, err := s.pool.Query(ctx, q, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Review
	for rows.Next() {
		var r domain.Review
		if err := rows.Scan(&r.ID, &r.AppointmentID, &r.ClientUserID, &r.MasterUserID, &r.MasterRating, &r.ResultRating, &r.Comment, &r.PublishAllowed, &r.Hidden, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
