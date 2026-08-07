package store

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
)

const portfolioCols = `id, master_id, media_id, caption, sort_order, created_at`

func (s *Store) ListPortfolioByMaster(ctx context.Context, masterID uuid.UUID) ([]domain.PortfolioItem, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+portfolioCols+`
FROM portfolio_items
WHERE master_id = $1
ORDER BY sort_order ASC, created_at DESC`, masterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPortfolioItems(rows)
}

func (s *Store) GetPortfolioItem(ctx context.Context, id uuid.UUID) (*domain.PortfolioItem, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+portfolioCols+` FROM portfolio_items WHERE id=$1`, id)
	var item domain.PortfolioItem
	if err := row.Scan(&item.ID, &item.MasterID, &item.MediaID, &item.Caption, &item.SortOrder, &item.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &item, nil
}

func (s *Store) InsertPortfolioItem(ctx context.Context, item domain.PortfolioItem) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO portfolio_items(id, master_id, media_id, caption, sort_order, created_at)
VALUES ($1,$2,$3,$4,$5,$6)`,
		item.ID, item.MasterID, item.MediaID, item.Caption, item.SortOrder, item.CreatedAt)
	return err
}

func (s *Store) DeletePortfolioItem(ctx context.Context, id uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM portfolio_items WHERE id=$1`, id)
	return err
}

func scanPortfolioItems(rows pgx.Rows) ([]domain.PortfolioItem, error) {
	var out []domain.PortfolioItem
	for rows.Next() {
		var item domain.PortfolioItem
		if err := rows.Scan(&item.ID, &item.MasterID, &item.MediaID, &item.Caption, &item.SortOrder, &item.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
