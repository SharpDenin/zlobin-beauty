package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/domain"
)

func (s *Store) GetModelPreference(ctx context.Context, userID uuid.UUID) (*domain.ModelPreference, error) {
	row := s.pool.QueryRow(ctx, `
SELECT user_id, willing, notify, categories, city, date_from, date_to, created_at, updated_at
FROM client_model_preferences WHERE user_id=$1`, userID)
	p, err := scanPref(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return p, err
}

func (s *Store) UpsertModelPreference(ctx context.Context, p domain.ModelPreference) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO client_model_preferences(user_id, willing, notify, categories, city, date_from, date_to, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
ON CONFLICT (user_id) DO UPDATE SET
  willing=EXCLUDED.willing, notify=EXCLUDED.notify, categories=EXCLUDED.categories,
  city=EXCLUDED.city, date_from=EXCLUDED.date_from, date_to=EXCLUDED.date_to, updated_at=EXCLUDED.updated_at`,
		p.UserID, p.Willing, p.Notify, p.Categories, p.City, p.DateFrom, p.DateTo, p.CreatedAt, p.UpdatedAt)
	return err
}

func (s *Store) MatchModelPreferences(ctx context.Context, category, city string, day time.Time) ([]domain.ModelPreference, error) {
	rows, err := s.pool.Query(ctx, `
SELECT user_id, willing, notify, categories, city, date_from, date_to, created_at, updated_at
FROM client_model_preferences
WHERE willing = TRUE AND notify = TRUE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ModelPreference
	for rows.Next() {
		p, err := scanPref(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

func scanPref(row interface{ Scan(dest ...any) error }) (*domain.ModelPreference, error) {
	var p domain.ModelPreference
	if err := row.Scan(&p.UserID, &p.Willing, &p.Notify, &p.Categories, &p.City, &p.DateFrom, &p.DateTo, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return nil, err
	}
	if p.Categories == nil {
		p.Categories = []string{}
	}
	return &p, nil
}
