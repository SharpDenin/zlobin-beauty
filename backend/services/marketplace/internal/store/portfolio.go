package store

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
)

const portfolioCols = `id, master_id, media_id, caption, title, description, category, media_type, sort_order, created_at, updated_at`

func (s *Store) ListPortfolioByMaster(ctx context.Context, masterID uuid.UUID, category string) ([]domain.PortfolioItem, error) {
	category = strings.TrimSpace(category)
	var (
		rows pgx.Rows
		err  error
	)
	if category == "" {
		rows, err = s.pool.Query(ctx, `
SELECT `+portfolioCols+`
FROM portfolio_items
WHERE master_id = $1
ORDER BY sort_order ASC, created_at DESC`, masterID)
	} else {
		rows, err = s.pool.Query(ctx, `
SELECT `+portfolioCols+`
FROM portfolio_items
WHERE master_id = $1 AND category = $2
ORDER BY sort_order ASC, created_at DESC`, masterID, category)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPortfolioItems(rows)
}

func (s *Store) GetPortfolioItem(ctx context.Context, id uuid.UUID) (*domain.PortfolioItem, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+portfolioCols+` FROM portfolio_items WHERE id=$1`, id)
	item, err := scanPortfolioItem(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return item, nil
}

func (s *Store) InsertPortfolioItem(ctx context.Context, item domain.PortfolioItem) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO portfolio_items(id, master_id, media_id, caption, title, description, category, media_type, sort_order, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		item.ID, item.MasterID, item.MediaID, item.Caption, item.Title, item.Description, item.Category, item.MediaType,
		item.SortOrder, item.CreatedAt, item.UpdatedAt)
	return err
}

func (s *Store) UpdatePortfolioItem(ctx context.Context, item domain.PortfolioItem) error {
	ct, err := s.pool.Exec(ctx, `
UPDATE portfolio_items
SET media_id=$2, caption=$3, title=$4, description=$5, category=$6, media_type=$7, sort_order=$8, updated_at=$9
WHERE id=$1 AND master_id=$10`,
		item.ID, item.MediaID, item.Caption, item.Title, item.Description, item.Category, item.MediaType,
		item.SortOrder, item.UpdatedAt, item.MasterID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) DeletePortfolioItem(ctx context.Context, id uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM portfolio_items WHERE id=$1`, id)
	return err
}

// ReorderPortfolioItems sets sort_order from the given ordered IDs (must all belong to masterID).
func (s *Store) ReorderPortfolioItems(ctx context.Context, masterID uuid.UUID, orderedIDs []uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var count int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM portfolio_items WHERE master_id=$1`, masterID).Scan(&count); err != nil {
		return err
	}
	if count != len(orderedIDs) {
		return fmt.Errorf("portfolio reorder: expected %d ids, got %d", count, len(orderedIDs))
	}
	seen := make(map[uuid.UUID]struct{}, len(orderedIDs))
	for i, id := range orderedIDs {
		if _, dup := seen[id]; dup {
			return fmt.Errorf("portfolio reorder: duplicate id %s", id)
		}
		seen[id] = struct{}{}
		ct, err := tx.Exec(ctx, `
UPDATE portfolio_items SET sort_order=$1, updated_at=now()
WHERE id=$2 AND master_id=$3`, i, id, masterID)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return fmt.Errorf("portfolio reorder: id %s not owned", id)
		}
	}
	return tx.Commit(ctx)
}

func scanPortfolioItem(row pgx.Row) (*domain.PortfolioItem, error) {
	var item domain.PortfolioItem
	if err := row.Scan(
		&item.ID, &item.MasterID, &item.MediaID, &item.Caption, &item.Title, &item.Description,
		&item.Category, &item.MediaType, &item.SortOrder, &item.CreatedAt, &item.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &item, nil
}

func scanPortfolioItems(rows pgx.Rows) ([]domain.PortfolioItem, error) {
	var out []domain.PortfolioItem
	for rows.Next() {
		var item domain.PortfolioItem
		if err := rows.Scan(
			&item.ID, &item.MasterID, &item.MediaID, &item.Caption, &item.Title, &item.Description,
			&item.Category, &item.MediaType, &item.SortOrder, &item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
