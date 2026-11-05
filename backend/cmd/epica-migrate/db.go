package main

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DBSet struct {
	Marketplace *pgxpool.Pool
	Media       *pgxpool.Pool
	Identity    *pgxpool.Pool
	Orgs        *pgxpool.Pool
}

func openPool(ctx context.Context, dsn, label string) (*pgxpool.Pool, error) {
	if dsn == "" {
		return nil, fmt.Errorf("%s database URL is empty", label)
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("%s dsn: %w", label, err)
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("%s connect: %w", label, err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("%s ping: %w", label, err)
	}
	return pool, nil
}

func openDBSet(ctx context.Context, prefix string, needIdentity bool) (*DBSet, error) {
	mp, err := openPool(ctx, envOr(prefix+"_MARKETPLACE_DATABASE_URL", ""), prefix+" marketplace")
	if err != nil {
		return nil, err
	}
	media, err := openPool(ctx, envOr(prefix+"_MEDIA_DATABASE_URL", ""), prefix+" media")
	if err != nil {
		mp.Close()
		return nil, err
	}
	set := &DBSet{Marketplace: mp, Media: media}
	if needIdentity {
		id, err := openPool(ctx, envOr(prefix+"_IDENTITY_DATABASE_URL", ""), prefix+" identity")
		if err != nil {
			set.Close()
			return nil, err
		}
		orgs, err := openPool(ctx, envOr(prefix+"_ORGANIZATIONS_DATABASE_URL", ""), prefix+" organizations")
		if err != nil {
			id.Close()
			set.Close()
			return nil, err
		}
		set.Identity = id
		set.Orgs = orgs
	}
	return set, nil
}

func (s *DBSet) Close() {
	if s == nil {
		return
	}
	if s.Marketplace != nil {
		s.Marketplace.Close()
	}
	if s.Media != nil {
		s.Media.Close()
	}
	if s.Identity != nil {
		s.Identity.Close()
	}
	if s.Orgs != nil {
		s.Orgs.Close()
	}
}

func loadEpicaArticles(ctx context.Context, mp *pgxpool.Pool) ([]ArticleRow, error) {
	rows, err := mp.Query(ctx, `
SELECT id, title, category, content, author_user_id, author_org_id, author_name,
       published, created_at, updated_at, brand, product_id, published_at,
       content_format, cover_media_id, reading_time_minutes, status, view_count, archived_at
FROM knowledge_articles
WHERE brand = $1
ORDER BY created_at, id`, epicaBrand)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ArticleRow
	for rows.Next() {
		var a ArticleRow
		if err := rows.Scan(
			&a.ID, &a.Title, &a.Category, &a.Content, &a.AuthorUserID, &a.AuthorOrgID, &a.AuthorName,
			&a.Published, &a.CreatedAt, &a.UpdatedAt, &a.Brand, &a.ProductID, &a.PublishedAt,
			&a.ContentFormat, &a.CoverMediaID, &a.ReadingTimeMinutes, &a.Status, &a.ViewCount, &a.ArchivedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func loadMediaByIDs(ctx context.Context, media *pgxpool.Pool, ids []uuid.UUID) ([]MediaRow, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := media.Query(ctx, `
SELECT id, owner_user_id, purpose, content_type, size_bytes, sha256, object_key, bucket, original_name, created_at
FROM media_objects
WHERE id = ANY($1)
ORDER BY created_at, id`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MediaRow
	for rows.Next() {
		var m MediaRow
		if err := rows.Scan(
			&m.ID, &m.OwnerUserID, &m.Purpose, &m.ContentType, &m.SizeBytes, &m.SHA256,
			&m.ObjectKey, &m.Bucket, &m.OriginalName, &m.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func articleExists(ctx context.Context, mp *pgxpool.Pool, id uuid.UUID) (bool, *ArticleRow, error) {
	var a ArticleRow
	err := mp.QueryRow(ctx, `
SELECT id, title, category, content, author_user_id, author_org_id, author_name,
       published, created_at, updated_at, brand, product_id, published_at,
       content_format, cover_media_id, reading_time_minutes, status, view_count, archived_at
FROM knowledge_articles WHERE id=$1`, id).Scan(
		&a.ID, &a.Title, &a.Category, &a.Content, &a.AuthorUserID, &a.AuthorOrgID, &a.AuthorName,
		&a.Published, &a.CreatedAt, &a.UpdatedAt, &a.Brand, &a.ProductID, &a.PublishedAt,
		&a.ContentFormat, &a.CoverMediaID, &a.ReadingTimeMinutes, &a.Status, &a.ViewCount, &a.ArchivedAt,
	)
	if err == pgx.ErrNoRows {
		return false, nil, nil
	}
	if err != nil {
		return false, nil, err
	}
	return true, &a, nil
}

func mediaExists(ctx context.Context, media *pgxpool.Pool, id uuid.UUID) (bool, *MediaRow, error) {
	var m MediaRow
	err := media.QueryRow(ctx, `
SELECT id, owner_user_id, purpose, content_type, size_bytes, sha256, object_key, bucket, original_name, created_at
FROM media_objects WHERE id=$1`, id).Scan(
		&m.ID, &m.OwnerUserID, &m.Purpose, &m.ContentType, &m.SizeBytes, &m.SHA256,
		&m.ObjectKey, &m.Bucket, &m.OriginalName, &m.CreatedAt,
	)
	if err == pgx.ErrNoRows {
		return false, nil, nil
	}
	if err != nil {
		return false, nil, err
	}
	return true, &m, nil
}

func mediaByObjectKey(ctx context.Context, media *pgxpool.Pool, key string) (bool, *MediaRow, error) {
	var m MediaRow
	err := media.QueryRow(ctx, `
SELECT id, owner_user_id, purpose, content_type, size_bytes, sha256, object_key, bucket, original_name, created_at
FROM media_objects WHERE object_key=$1`, key).Scan(
		&m.ID, &m.OwnerUserID, &m.Purpose, &m.ContentType, &m.SizeBytes, &m.SHA256,
		&m.ObjectKey, &m.Bucket, &m.OriginalName, &m.CreatedAt,
	)
	if err == pgx.ErrNoRows {
		return false, nil, nil
	}
	if err != nil {
		return false, nil, err
	}
	return true, &m, nil
}

func userExists(ctx context.Context, identity *pgxpool.Pool, id uuid.UUID) (bool, error) {
	var n int
	err := identity.QueryRow(ctx, `SELECT 1 FROM users WHERE id=$1`, id).Scan(&n)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

func orgExists(ctx context.Context, orgs *pgxpool.Pool, id uuid.UUID) (bool, error) {
	var n int
	err := orgs.QueryRow(ctx, `SELECT 1 FROM organizations WHERE id=$1`, id).Scan(&n)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

func insertMedia(ctx context.Context, tx pgx.Tx, m MediaRow) error {
	_, err := tx.Exec(ctx, `
INSERT INTO media_objects(
  id, owner_user_id, purpose, content_type, size_bytes, sha256, object_key, bucket, original_name, created_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
ON CONFLICT (id) DO NOTHING`,
		m.ID, m.OwnerUserID, m.Purpose, m.ContentType, m.SizeBytes, m.SHA256, m.ObjectKey, m.Bucket, m.OriginalName, m.CreatedAt,
	)
	return err
}

func insertArticle(ctx context.Context, tx pgx.Tx, a ArticleRow) error {
	_, err := tx.Exec(ctx, `
INSERT INTO knowledge_articles(
  id, title, category, content, author_user_id, author_org_id, author_name,
  published, created_at, updated_at, brand, product_id, published_at,
  content_format, cover_media_id, reading_time_minutes, status, view_count, archived_at
) VALUES (
  $1,$2,$3,$4,$5,$6,$7,
  $8,$9,$10,$11,$12,$13,
  $14,$15,$16,$17,$18,$19
) ON CONFLICT (id) DO NOTHING`,
		a.ID, a.Title, a.Category, a.Content, a.AuthorUserID, a.AuthorOrgID, a.AuthorName,
		a.Published, a.CreatedAt, a.UpdatedAt, a.Brand, a.ProductID, a.PublishedAt,
		a.ContentFormat, a.CoverMediaID, a.ReadingTimeMinutes, a.Status, a.ViewCount, a.ArchivedAt,
	)
	return err
}
