package store

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zlobin/zlobin-beauty/backend/services/media/internal/domain"
)

type Store struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

const mediaCols = `id, owner_user_id, purpose, content_type, size_bytes, sha256, object_key, bucket, original_name, created_at`

func (s *Store) Insert(ctx context.Context, m domain.MediaObject) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO media_objects(id, owner_user_id, purpose, content_type, size_bytes, sha256, object_key, bucket, original_name, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		m.ID, m.OwnerUserID, m.Purpose, m.ContentType, m.SizeBytes, m.SHA256, m.ObjectKey, m.Bucket, m.OriginalName, m.CreatedAt)
	return err
}

func (s *Store) Get(ctx context.Context, id uuid.UUID) (*domain.MediaObject, error) {
	return s.scanMedia(s.pool.QueryRow(ctx, `SELECT `+mediaCols+` FROM media_objects WHERE id=$1`, id))
}

func (s *Store) Delete(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM media_objects WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) scanMedia(row pgx.Row) (*domain.MediaObject, error) {
	var m domain.MediaObject
	if err := row.Scan(&m.ID, &m.OwnerUserID, &m.Purpose, &m.ContentType, &m.SizeBytes, &m.SHA256, &m.ObjectKey, &m.Bucket, &m.OriginalName, &m.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}
