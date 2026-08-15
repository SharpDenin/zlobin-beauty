package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type RecurringAgreement struct {
	ID                uuid.UUID
	SupplierOrgID     uuid.UUID
	BuyerOrgID        uuid.UUID
	PickupBranchID    uuid.UUID
	Frequency         string
	PreferredWeekday  *int
	WindowStartMinute *int
	WindowEndMinute   *int
	StartDate         time.Time
	Status            string
	ProposedChange    json.RawMessage
	HorizonDays       int
	CreatedBy         uuid.UUID
	DecidedBy         *uuid.UUID
	CreatedAt         time.Time
	UpdatedAt         time.Time
	Items             []RecurringItem
}

type RecurringItem struct {
	ID                   uuid.UUID
	AgreementID          uuid.UUID
	ProductID            uuid.UUID
	Qty                  float64
	LastKnownPriceMinor  int64
}

func (s *Store) InsertRecurring(ctx context.Context, a RecurringAgreement) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `
INSERT INTO recurring_agreements(
  id, supplier_org_id, buyer_org_id, pickup_branch_id, frequency, preferred_weekday,
  window_start_minute, window_end_minute, start_date, status, proposed_change, horizon_days,
  created_by, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15)`,
		a.ID, a.SupplierOrgID, a.BuyerOrgID, a.PickupBranchID, a.Frequency, a.PreferredWeekday,
		a.WindowStartMinute, a.WindowEndMinute, a.StartDate, a.Status, stringOrJSON(a.ProposedChange),
		a.HorizonDays, a.CreatedBy, a.CreatedAt, a.UpdatedAt)
	if err != nil {
		return err
	}
	for _, it := range a.Items {
		if _, err := tx.Exec(ctx, `
INSERT INTO recurring_agreement_items(id, agreement_id, product_id, qty, last_known_price_minor)
VALUES ($1,$2,$3,$4,$5)`, it.ID, a.ID, it.ProductID, it.Qty, it.LastKnownPriceMinor); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func stringOrJSON(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "{}"
	}
	return string(raw)
}

func (s *Store) GetRecurring(ctx context.Context, id uuid.UUID) (*RecurringAgreement, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, supplier_org_id, buyer_org_id, pickup_branch_id, frequency, preferred_weekday,
       window_start_minute, window_end_minute, start_date, status, proposed_change, horizon_days,
       created_by, decided_by, created_at, updated_at
FROM recurring_agreements WHERE id=$1`, id)
	a, err := scanRecurring(row)
	if err != nil {
		return nil, err
	}
	if a == nil {
		return nil, nil
	}
	items, err := s.listRecurringItems(ctx, id)
	if err != nil {
		return nil, err
	}
	a.Items = items
	return a, nil
}

func scanRecurring(row pgx.Row) (*RecurringAgreement, error) {
	var a RecurringAgreement
	var proposed []byte
	err := row.Scan(&a.ID, &a.SupplierOrgID, &a.BuyerOrgID, &a.PickupBranchID, &a.Frequency, &a.PreferredWeekday,
		&a.WindowStartMinute, &a.WindowEndMinute, &a.StartDate, &a.Status, &proposed, &a.HorizonDays,
		&a.CreatedBy, &a.DecidedBy, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	a.ProposedChange = proposed
	return &a, nil
}

func (s *Store) listRecurringItems(ctx context.Context, id uuid.UUID) ([]RecurringItem, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, agreement_id, product_id, qty, last_known_price_minor
FROM recurring_agreement_items WHERE agreement_id=$1`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RecurringItem
	for rows.Next() {
		var it RecurringItem
		if err := rows.Scan(&it.ID, &it.AgreementID, &it.ProductID, &it.Qty, &it.LastKnownPriceMinor); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

func (s *Store) ListRecurringByOrg(ctx context.Context, orgID uuid.UUID, asSupplier bool) ([]RecurringAgreement, error) {
	q := `SELECT id FROM recurring_agreements WHERE buyer_org_id=$1 ORDER BY created_at DESC`
	if asSupplier {
		q = `SELECT id FROM recurring_agreements WHERE supplier_org_id=$1 ORDER BY created_at DESC`
	}
	rows, err := s.pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	out := make([]RecurringAgreement, 0, len(ids))
	for _, id := range ids {
		a, err := s.GetRecurring(ctx, id)
		if err != nil || a == nil {
			continue
		}
		out = append(out, *a)
	}
	return out, nil
}

func (s *Store) UpdateRecurringStatus(ctx context.Context, id uuid.UUID, status string, decidedBy *uuid.UUID, now time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE recurring_agreements SET status=$2, decided_by=$3, updated_at=$4 WHERE id=$1`, id, status, decidedBy, now)
	return err
}

func (s *Store) HasGeneratedOccurrence(ctx context.Context, agreementID uuid.UUID, day time.Time) (bool, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM recurring_generated_orders WHERE agreement_id=$1 AND occurrence_date=$2`, agreementID, day).Scan(&n)
	return n > 0, err
}

func (s *Store) InsertGeneratedOccurrence(ctx context.Context, agreementID uuid.UUID, day time.Time, orderID uuid.UUID, now time.Time) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO recurring_generated_orders(agreement_id, occurrence_date, order_id, created_at)
VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, agreementID, day, orderID, now)
	return err
}

func (s *Store) InsertRecurringException(ctx context.Context, id, agreementID uuid.UUID, kind, message string, productID *uuid.UUID, now time.Time) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO recurring_exceptions(id, agreement_id, kind, message, product_id, created_at)
VALUES ($1,$2,$3,$4,$5,$6)`, id, agreementID, kind, message, productID, now)
	return err
}

func (s *Store) InsertCommerceAudit(ctx context.Context, actor uuid.UUID, action, entityType string, entityID uuid.UUID, meta string, now time.Time) error {
	if meta == "" {
		meta = "{}"
	}
	_, err := s.pool.Exec(ctx, `
INSERT INTO commerce_audit_events(id, actor_user_id, action, entity_type, entity_id, meta, created_at)
VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`, ids.New(), actor, action, entityType, entityID, meta, now)
	return err
}
