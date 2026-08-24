package store

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

func (s *Store) CreateDispute(ctx context.Context, d domain.CardDispute, ev domain.DisputeEvent) (*domain.CardDispute, bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback(ctx)
	var out domain.CardDispute
	err = tx.QueryRow(ctx, `
INSERT INTO client_card_disputes(id, client_card_id, reporter_user_id, field_key, comment, status, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7)
RETURNING id, client_card_id, reporter_user_id, field_key, comment, status, created_at, resolved_at, resolved_by`,
		d.ID, d.ClientCardID, d.ReporterUserID, d.FieldKey, d.Comment, d.Status, d.CreatedAt,
	).Scan(&out.ID, &out.ClientCardID, &out.ReporterUserID, &out.FieldKey, &out.Comment, &out.Status, &out.CreatedAt, &out.ResolvedAt, &out.ResolvedBy)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			existing, getErr := s.GetOpenDispute(ctx, d.ClientCardID, d.FieldKey)
			return existing, true, getErr
		}
		return nil, false, err
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO client_card_dispute_events(id, dispute_id, actor_user_id, action, from_status, to_status, meta, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		ev.ID, out.ID, ev.ActorUserID, ev.Action, ev.FromStatus, ev.ToStatus, nonemptyJSON(ev.Meta), ev.CreatedAt); err != nil {
		return nil, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}
	return &out, false, nil
}

func (s *Store) GetOpenDispute(ctx context.Context, cardID uuid.UUID, fieldKey string) (*domain.CardDispute, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, client_card_id, reporter_user_id, field_key, comment, status, created_at, resolved_at, resolved_by
FROM client_card_disputes WHERE client_card_id=$1 AND field_key=$2 AND status='open'`, cardID, fieldKey)
	return scanDispute(row)
}

func (s *Store) GetDispute(ctx context.Context, id uuid.UUID) (*domain.CardDispute, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, client_card_id, reporter_user_id, field_key, comment, status, created_at, resolved_at, resolved_by
FROM client_card_disputes WHERE id=$1`, id)
	return scanDispute(row)
}

func (s *Store) ListDisputes(ctx context.Context, cardID uuid.UUID) ([]domain.CardDispute, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, client_card_id, reporter_user_id, field_key, comment, status, created_at, resolved_at, resolved_by
FROM client_card_disputes WHERE client_card_id=$1 ORDER BY created_at DESC`, cardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.CardDispute
	for rows.Next() {
		d, err := scanDispute(rows)
		if err != nil {
			return nil, err
		}
		if d != nil {
			out = append(out, *d)
		}
	}
	if out == nil {
		out = []domain.CardDispute{}
	}
	return out, rows.Err()
}

func (s *Store) ResolveDispute(ctx context.Context, d domain.CardDispute, ev domain.DisputeEvent) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `
UPDATE client_card_disputes SET status=$2, resolved_at=$3, resolved_by=$4
WHERE id=$1 AND status='open'`, d.ID, d.Status, d.ResolvedAt, d.ResolvedBy)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO client_card_dispute_events(id, dispute_id, actor_user_id, action, from_status, to_status, meta, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		ids.New(), d.ID, ev.ActorUserID, ev.Action, ev.FromStatus, ev.ToStatus, nonemptyJSON(ev.Meta), ev.CreatedAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type scanner interface {
	Scan(dest ...any) error
}

func scanDispute(row scanner) (*domain.CardDispute, error) {
	var d domain.CardDispute
	if err := row.Scan(&d.ID, &d.ClientCardID, &d.ReporterUserID, &d.FieldKey, &d.Comment, &d.Status, &d.CreatedAt, &d.ResolvedAt, &d.ResolvedBy); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &d, nil
}

func nonemptyJSON(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(`{}`)
	}
	return raw
}
