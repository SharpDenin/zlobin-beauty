package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/domain"
)

type Store struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// UpsertCardAndVisit gets-or-creates the client card for (organization_id, user_id)
// and idempotently inserts the visit row (unique on appointment_id). The
// returned bool reports whether a new visit row was actually inserted.
func (s *Store) UpsertCardAndVisit(ctx context.Context, card domain.ClientCard, visit domain.Visit) (*domain.ClientCard, *domain.Visit, bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, false, err
	}
	defer tx.Rollback(ctx)

	var outCard domain.ClientCard
	if err := tx.QueryRow(ctx, `
INSERT INTO client_cards(id, organization_id, user_id, display_name, phone, email, preferences, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
ON CONFLICT (organization_id, user_id) DO UPDATE SET
  display_name = CASE WHEN EXCLUDED.display_name <> '' AND EXCLUDED.display_name <> 'Клиент' THEN EXCLUDED.display_name ELSE client_cards.display_name END,
  phone = COALESCE(EXCLUDED.phone, client_cards.phone),
  email = COALESCE(EXCLUDED.email, client_cards.email),
  updated_at = EXCLUDED.updated_at
RETURNING id, organization_id, user_id, display_name, phone, email, preferences, created_at, updated_at`,
		card.ID, card.OrganizationID, card.UserID, card.DisplayName, card.Phone, card.Email, card.Preferences, card.CreatedAt, card.UpdatedAt,
	).Scan(&outCard.ID, &outCard.OrganizationID, &outCard.UserID, &outCard.DisplayName, &outCard.Phone, &outCard.Email, &outCard.Preferences, &outCard.CreatedAt, &outCard.UpdatedAt); err != nil {
		return nil, nil, false, err
	}

	visit.ClientCardID = outCard.ID
	tag, err := tx.Exec(ctx, `
INSERT INTO visits(id, client_card_id, appointment_id, organization_id, master_user_id, service_name, price_minor, currency, started_at, completed_at, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
ON CONFLICT (appointment_id) DO NOTHING`,
		visit.ID, visit.ClientCardID, visit.AppointmentID, visit.OrganizationID, visit.MasterUserID, visit.ServiceName, visit.PriceMinor, visit.Currency, visit.StartedAt, visit.CompletedAt, visit.CreatedAt)
	if err != nil {
		return nil, nil, false, err
	}
	created := tag.RowsAffected() > 0

	outVisit, err := s.getVisitByAppointmentTx(ctx, tx, visit.AppointmentID)
	if err != nil {
		return nil, nil, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, false, err
	}
	return &outCard, outVisit, created, nil
}

func (s *Store) getVisitByAppointmentTx(ctx context.Context, tx pgx.Tx, appointmentID uuid.UUID) (*domain.Visit, error) {
	row := tx.QueryRow(ctx, `
SELECT id, client_card_id, appointment_id, organization_id, master_user_id, service_name, price_minor, currency, started_at, completed_at, created_at
FROM visits WHERE appointment_id=$1`, appointmentID)
	return scanVisit(row)
}

func (s *Store) GetCard(ctx context.Context, id uuid.UUID) (*domain.ClientCard, error) {
	return scanCard(s.pool.QueryRow(ctx, `
SELECT id, organization_id, user_id, display_name, phone, email, preferences, created_at, updated_at
FROM client_cards WHERE id=$1`, id))
}

// ListCardsForUser returns the card(s) owned by the given user (as a client).
func (s *Store) ListCardsForUser(ctx context.Context, userID uuid.UUID) ([]domain.ClientCard, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, organization_id, user_id, display_name, phone, email, preferences, created_at, updated_at
FROM client_cards WHERE user_id=$1 ORDER BY updated_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCards(rows)
}

// ListCardsForMaster returns the client cards the given master has served,
// optionally filtered to a single organization.
func (s *Store) ListCardsForMaster(ctx context.Context, masterUserID uuid.UUID, orgID *uuid.UUID) ([]domain.ClientCard, error) {
	rows, err := s.pool.Query(ctx, `
SELECT DISTINCT c.id, c.organization_id, c.user_id, c.display_name, c.phone, c.email, c.preferences, c.created_at, c.updated_at
FROM client_cards c
JOIN visits v ON v.client_card_id = c.id
WHERE v.master_user_id=$1 AND ($2::uuid IS NULL OR c.organization_id=$2)
ORDER BY c.updated_at DESC`, masterUserID, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCards(rows)
}

type VisitStats struct {
	VisitCount   int
	FirstVisitAt *time.Time
	LastVisitAt  *time.Time
}

func (s *Store) VisitStatsForCards(ctx context.Context, cardIDs []uuid.UUID) (map[uuid.UUID]VisitStats, error) {
	out := make(map[uuid.UUID]VisitStats, len(cardIDs))
	if len(cardIDs) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx, `
SELECT client_card_id, COUNT(*)::int, MIN(completed_at), MAX(completed_at)
FROM visits
WHERE client_card_id = ANY($1)
GROUP BY client_card_id`, cardIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var st VisitStats
		if err := rows.Scan(&id, &st.VisitCount, &st.FirstVisitAt, &st.LastVisitAt); err != nil {
			return nil, err
		}
		out[id] = st
	}
	return out, rows.Err()
}

func (s *Store) GetVisitByAppointment(ctx context.Context, appointmentID uuid.UUID) (*domain.Visit, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, client_card_id, appointment_id, organization_id, master_user_id, service_name, price_minor, currency, started_at, completed_at, created_at
FROM visits WHERE appointment_id=$1`, appointmentID)
	return scanVisit(row)
}

func (s *Store) MasterHasVisitOnCard(ctx context.Context, cardID, masterUserID uuid.UUID) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM visits WHERE client_card_id=$1 AND master_user_id=$2)`, cardID, masterUserID).Scan(&ok)
	return ok, err
}

func (s *Store) ListVisits(ctx context.Context, cardID uuid.UUID) ([]domain.Visit, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, client_card_id, appointment_id, organization_id, master_user_id, service_name, price_minor, currency, started_at, completed_at, created_at
FROM visits WHERE client_card_id=$1 ORDER BY completed_at DESC`, cardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Visit
	for rows.Next() {
		var v domain.Visit
		if err := rows.Scan(&v.ID, &v.ClientCardID, &v.AppointmentID, &v.OrganizationID, &v.MasterUserID, &v.ServiceName, &v.PriceMinor, &v.Currency, &v.StartedAt, &v.CompletedAt, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) GetVisit(ctx context.Context, id uuid.UUID) (*domain.Visit, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, client_card_id, appointment_id, organization_id, master_user_id, service_name, price_minor, currency, started_at, completed_at, created_at
FROM visits WHERE id=$1`, id)
	return scanVisit(row)
}

func (s *Store) CreateNote(ctx context.Context, n domain.VisitNote) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO visit_notes(id, visit_id, author_user_id, body, created_at) VALUES ($1,$2,$3,$4,$5)`,
		n.ID, n.VisitID, n.AuthorUserID, n.Body, n.CreatedAt)
	return err
}

func (s *Store) CreateFormula(ctx context.Context, f domain.ColorFormula) error {
	components := f.Components
	if len(components) == 0 {
		components = []byte("[]")
	}
	_, err := s.pool.Exec(ctx, `
INSERT INTO color_formulas(id, client_card_id, visit_id, name, brand, components, oxidizer, ratio, comment, created_by, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		f.ID, f.ClientCardID, f.VisitID, f.Name, f.Brand, components, f.Oxidizer, f.Ratio, f.Comment, f.CreatedBy, f.CreatedAt)
	return err
}

func (s *Store) ListFormulas(ctx context.Context, cardID uuid.UUID) ([]domain.ColorFormula, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, client_card_id, visit_id, name, brand, components, oxidizer, ratio, comment, created_by, created_at
FROM color_formulas WHERE client_card_id=$1 ORDER BY created_at DESC`, cardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ColorFormula
	for rows.Next() {
		var f domain.ColorFormula
		var comps []byte
		if err := rows.Scan(&f.ID, &f.ClientCardID, &f.VisitID, &f.Name, &f.Brand, &comps, &f.Oxidizer, &f.Ratio, &f.Comment, &f.CreatedBy, &f.CreatedAt); err != nil {
			return nil, err
		}
		f.Components = comps
		out = append(out, f)
	}
	return out, rows.Err()
}

func (s *Store) UpsertConsent(ctx context.Context, c domain.Consent) (*domain.Consent, error) {
	var out domain.Consent
	err := s.pool.QueryRow(ctx, `
INSERT INTO consents(id, client_card_id, consent_type, granted, created_at)
VALUES ($1,$2,$3,$4,$5)
ON CONFLICT (client_card_id, consent_type) DO UPDATE SET granted=EXCLUDED.granted
RETURNING id, client_card_id, consent_type, granted, created_at`,
		c.ID, c.ClientCardID, c.ConsentType, c.Granted, c.CreatedAt,
	).Scan(&out.ID, &out.ClientCardID, &out.ConsentType, &out.Granted, &out.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func scanCard(row pgx.Row) (*domain.ClientCard, error) {
	var c domain.ClientCard
	if err := row.Scan(&c.ID, &c.OrganizationID, &c.UserID, &c.DisplayName, &c.Phone, &c.Email, &c.Preferences, &c.CreatedAt, &c.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &c, nil
}

func scanCards(rows pgx.Rows) ([]domain.ClientCard, error) {
	var out []domain.ClientCard
	for rows.Next() {
		var c domain.ClientCard
		if err := rows.Scan(&c.ID, &c.OrganizationID, &c.UserID, &c.DisplayName, &c.Phone, &c.Email, &c.Preferences, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func scanVisit(row pgx.Row) (*domain.Visit, error) {
	var v domain.Visit
	if err := row.Scan(&v.ID, &v.ClientCardID, &v.AppointmentID, &v.OrganizationID, &v.MasterUserID, &v.ServiceName, &v.PriceMinor, &v.Currency, &v.StartedAt, &v.CompletedAt, &v.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &v, nil
}
