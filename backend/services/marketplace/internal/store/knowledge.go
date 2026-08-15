package store

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

const knowledgeCols = `id, title, category, content, content_format, cover_media_id, reading_time_minutes, brand, product_id, author_user_id, author_org_id, author_name, published, published_at, created_at, updated_at, status, view_count, archived_at`

type KnowledgeListFilter struct {
	Category          string
	Brand             string
	Query             string
	SupplierOrgID     *uuid.UUID
	ProductID         *uuid.UUID
	ProductCategoryID *uuid.UUID
	ViewerID          *uuid.UUID
	AuthorUserID      *uuid.UUID
	FavoritesOnly     bool
	PublishedOnly     bool
	Limit             int
}

func (s *Store) CreateKnowledgeArticle(ctx context.Context, a domain.KnowledgeArticle) error {
	format := a.ContentFormat
	if format == "" {
		format = "plain"
	}
	status := a.Status
	if status == "" {
		if a.Published {
			status = domain.KnowledgeStatusPublished
		} else {
			status = domain.KnowledgeStatusDraft
		}
	}
	_, err := s.pool.Exec(ctx, `
INSERT INTO knowledge_articles(`+knowledgeCols+`)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
		a.ID, a.Title, a.Category, a.Content, format, a.CoverMediaID, a.ReadingTimeMinutes, a.Brand, a.ProductID,
		a.AuthorUserID, a.AuthorOrgID, a.AuthorName, a.Published, a.PublishedAt, a.CreatedAt, a.UpdatedAt,
		status, a.ViewCount, a.ArchivedAt)
	return err
}

func (s *Store) UpdateKnowledgeArticle(ctx context.Context, a domain.KnowledgeArticle) error {
	format := a.ContentFormat
	if format == "" {
		format = "plain"
	}
	status := a.Status
	if status == "" {
		if a.Published {
			status = domain.KnowledgeStatusPublished
		} else {
			status = domain.KnowledgeStatusDraft
		}
	}
	tag, err := s.pool.Exec(ctx, `
UPDATE knowledge_articles
SET title=$2, category=$3, content=$4, content_format=$5, cover_media_id=$6, reading_time_minutes=$7,
    brand=$8, product_id=$9, author_org_id=$10, author_name=$11, published=$12, published_at=$13, updated_at=$14,
    status=$15, archived_at=$16
WHERE id=$1`, a.ID, a.Title, a.Category, a.Content, format, a.CoverMediaID, a.ReadingTimeMinutes,
		a.Brand, a.ProductID, a.AuthorOrgID, a.AuthorName, a.Published, a.PublishedAt, a.UpdatedAt,
		status, a.ArchivedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("article not found")
	}
	return nil
}

func (s *Store) GetKnowledgeArticle(ctx context.Context, id uuid.UUID) (*domain.KnowledgeArticle, error) {
	return s.GetKnowledgeArticleForViewer(ctx, id, nil)
}

func (s *Store) GetKnowledgeArticleForViewer(ctx context.Context, id uuid.UUID, viewerID *uuid.UUID) (*domain.KnowledgeArticle, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+knowledgeCols+` FROM knowledge_articles WHERE id=$1`, id)
	a, err := scanKnowledge(row)
	if err != nil || a == nil {
		return a, err
	}
	items := []domain.KnowledgeArticle{*a}
	if err := s.loadKnowledgeRelations(ctx, items, viewerID); err != nil {
		return nil, err
	}
	return &items[0], nil
}

func (s *Store) ListKnowledgeArticles(ctx context.Context, f KnowledgeListFilter) ([]domain.KnowledgeArticle, error) {
	if f.Limit <= 0 {
		f.Limit = 100
	}
	if f.Limit > 500 {
		f.Limit = 500
	}

	var b strings.Builder
	args := make([]any, 0, 12)
	n := 1
	b.WriteString(`SELECT ` + knowledgeCols + ` FROM knowledge_articles ka WHERE 1=1`)

	if f.PublishedOnly {
		b.WriteString(` AND ka.status = 'published' AND ka.published = TRUE`)
	}
	if f.AuthorUserID != nil {
		b.WriteString(fmt.Sprintf(` AND ka.author_user_id=$%d`, n))
		args = append(args, *f.AuthorUserID)
		n++
	}
	if cat := strings.TrimSpace(f.Category); cat != "" {
		b.WriteString(fmt.Sprintf(` AND ka.category ILIKE $%d`, n))
		args = append(args, cat)
		n++
	}
	if brand := strings.TrimSpace(f.Brand); brand != "" {
		b.WriteString(fmt.Sprintf(` AND ka.brand ILIKE $%d`, n))
		args = append(args, brand)
		n++
	}
	if f.SupplierOrgID != nil {
		b.WriteString(fmt.Sprintf(` AND ka.author_org_id=$%d`, n))
		args = append(args, *f.SupplierOrgID)
		n++
	}
	if f.ProductID != nil {
		b.WriteString(fmt.Sprintf(` AND (ka.product_id=$%d OR EXISTS (SELECT 1 FROM knowledge_article_products p WHERE p.article_id=ka.id AND p.product_id=$%d))`, n, n))
		args = append(args, *f.ProductID)
		n++
	}
	if f.ProductCategoryID != nil {
		b.WriteString(fmt.Sprintf(` AND EXISTS (SELECT 1 FROM knowledge_article_categories c WHERE c.article_id=ka.id AND c.category_id=$%d)`, n))
		args = append(args, *f.ProductCategoryID)
		n++
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		like := "%" + q + "%"
		b.WriteString(fmt.Sprintf(` AND (ka.title ILIKE $%d OR ka.brand ILIKE $%d OR ka.category ILIKE $%d OR ka.content ILIKE $%d)`, n, n, n, n))
		args = append(args, like)
		n++
	}
	if f.FavoritesOnly {
		if f.ViewerID == nil {
			return []domain.KnowledgeArticle{}, nil
		}
		b.WriteString(fmt.Sprintf(` AND EXISTS (SELECT 1 FROM knowledge_favorites fav WHERE fav.article_id=ka.id AND fav.user_id=$%d)`, n))
		args = append(args, *f.ViewerID)
		n++
	}

	b.WriteString(fmt.Sprintf(` ORDER BY ka.published_at DESC NULLS LAST, ka.created_at DESC LIMIT $%d`, n))
	args = append(args, f.Limit)

	rows, err := s.pool.Query(ctx, b.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.KnowledgeArticle
	for rows.Next() {
		a, err := scanKnowledgeRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := s.loadKnowledgeRelations(ctx, out, f.ViewerID); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) ReplaceKnowledgeProducts(ctx context.Context, articleID uuid.UUID, productIDs []uuid.UUID) error {
	ids := uniqueUUIDs(productIDs)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM knowledge_article_products WHERE article_id=$1`, articleID); err != nil {
		return err
	}
	for _, pid := range ids {
		if _, err := tx.Exec(ctx, `
INSERT INTO knowledge_article_products(article_id, product_id) VALUES ($1,$2)`, articleID, pid); err != nil {
			return err
		}
	}
	var first *uuid.UUID
	if len(ids) > 0 {
		first = &ids[0]
	}
	if _, err := tx.Exec(ctx, `UPDATE knowledge_articles SET product_id=$2 WHERE id=$1`, articleID, first); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) ReplaceKnowledgeCategories(ctx context.Context, articleID uuid.UUID, categoryIDs []uuid.UUID) error {
	ids := uniqueUUIDs(categoryIDs)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM knowledge_article_categories WHERE article_id=$1`, articleID); err != nil {
		return err
	}
	for _, cid := range ids {
		if _, err := tx.Exec(ctx, `
INSERT INTO knowledge_article_categories(article_id, category_id) VALUES ($1,$2)`, articleID, cid); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) AddKnowledgeFavorite(ctx context.Context, userID, articleID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO knowledge_favorites(user_id, article_id) VALUES ($1,$2)
ON CONFLICT DO NOTHING`, userID, articleID)
	return err
}

func (s *Store) RemoveKnowledgeFavorite(ctx context.Context, userID, articleID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM knowledge_favorites WHERE user_id=$1 AND article_id=$2`, userID, articleID)
	return err
}

func (s *Store) IncrementKnowledgeViewCount(ctx context.Context, id uuid.UUID) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
UPDATE knowledge_articles SET view_count = view_count + 1
WHERE id=$1 AND status='published'
RETURNING view_count`, id).Scan(&n)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil
		}
		return 0, err
	}
	return n, nil
}

func (s *Store) loadKnowledgeRelations(ctx context.Context, items []domain.KnowledgeArticle, viewerID *uuid.UUID) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, len(items))
	index := make(map[uuid.UUID]int, len(items))
	for i := range items {
		ids[i] = items[i].ID
		index[items[i].ID] = i
		if items[i].ProductIDs == nil {
			items[i].ProductIDs = []uuid.UUID{}
		}
		if items[i].CategoryIDs == nil {
			items[i].CategoryIDs = []uuid.UUID{}
		}
	}

	prodRows, err := s.pool.Query(ctx, `
SELECT article_id, product_id FROM knowledge_article_products
WHERE article_id = ANY($1)
ORDER BY created_at, product_id`, ids)
	if err != nil {
		return err
	}
	defer prodRows.Close()
	for prodRows.Next() {
		var articleID, productID uuid.UUID
		if err := prodRows.Scan(&articleID, &productID); err != nil {
			return err
		}
		i, ok := index[articleID]
		if !ok {
			continue
		}
		items[i].ProductIDs = append(items[i].ProductIDs, productID)
	}
	if err := prodRows.Err(); err != nil {
		return err
	}

	for i := range items {
		if len(items[i].ProductIDs) == 0 && items[i].ProductID != nil {
			items[i].ProductIDs = []uuid.UUID{*items[i].ProductID}
		} else if len(items[i].ProductIDs) > 0 {
			pid := items[i].ProductIDs[0]
			items[i].ProductID = &pid
		}
	}

	catRows, err := s.pool.Query(ctx, `
SELECT article_id, category_id FROM knowledge_article_categories
WHERE article_id = ANY($1)
ORDER BY created_at, category_id`, ids)
	if err != nil {
		return err
	}
	defer catRows.Close()
	for catRows.Next() {
		var articleID, categoryID uuid.UUID
		if err := catRows.Scan(&articleID, &categoryID); err != nil {
			return err
		}
		i, ok := index[articleID]
		if !ok {
			continue
		}
		items[i].CategoryIDs = append(items[i].CategoryIDs, categoryID)
	}
	if err := catRows.Err(); err != nil {
		return err
	}

	if viewerID != nil {
		favRows, err := s.pool.Query(ctx, `
SELECT article_id FROM knowledge_favorites
WHERE user_id=$1 AND article_id = ANY($2)`, *viewerID, ids)
		if err != nil {
			return err
		}
		defer favRows.Close()
		for favRows.Next() {
			var articleID uuid.UUID
			if err := favRows.Scan(&articleID); err != nil {
				return err
			}
			if i, ok := index[articleID]; ok {
				items[i].Favorite = true
			}
		}
		if err := favRows.Err(); err != nil {
			return err
		}
	}
	return nil
}

func scanKnowledge(row pgx.Row) (*domain.KnowledgeArticle, error) {
	var a domain.KnowledgeArticle
	if err := row.Scan(&a.ID, &a.Title, &a.Category, &a.Content, &a.ContentFormat, &a.CoverMediaID, &a.ReadingTimeMinutes,
		&a.Brand, &a.ProductID, &a.AuthorUserID, &a.AuthorOrgID, &a.AuthorName,
		&a.Published, &a.PublishedAt, &a.CreatedAt, &a.UpdatedAt, &a.Status, &a.ViewCount, &a.ArchivedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	normalizeKnowledge(&a)
	return &a, nil
}

func scanKnowledgeRow(rows pgx.Rows) (*domain.KnowledgeArticle, error) {
	var a domain.KnowledgeArticle
	if err := rows.Scan(&a.ID, &a.Title, &a.Category, &a.Content, &a.ContentFormat, &a.CoverMediaID, &a.ReadingTimeMinutes,
		&a.Brand, &a.ProductID, &a.AuthorUserID, &a.AuthorOrgID, &a.AuthorName,
		&a.Published, &a.PublishedAt, &a.CreatedAt, &a.UpdatedAt, &a.Status, &a.ViewCount, &a.ArchivedAt); err != nil {
		return nil, err
	}
	normalizeKnowledge(&a)
	return &a, nil
}

func normalizeKnowledge(a *domain.KnowledgeArticle) {
	if a.ContentFormat == "" {
		a.ContentFormat = "plain"
	}
	if a.Status == "" {
		if a.Published {
			a.Status = domain.KnowledgeStatusPublished
		} else {
			a.Status = domain.KnowledgeStatusDraft
		}
	}
	a.Published = a.Status == domain.KnowledgeStatusPublished
	if a.ProductIDs == nil {
		a.ProductIDs = []uuid.UUID{}
	}
	if a.CategoryIDs == nil {
		a.CategoryIDs = []uuid.UUID{}
	}
}

func uniqueUUIDs(ids []uuid.UUID) []uuid.UUID {
	seen := make(map[uuid.UUID]struct{}, len(ids))
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if id == uuid.Nil {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}
