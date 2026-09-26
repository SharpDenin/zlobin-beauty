package store

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
)

type AppointmentListFilter struct {
	Query          string
	Status         string
	OrganizationID *uuid.UUID
	MasterUserID   *uuid.UUID
	ClientUserID   *uuid.UUID
	From           *time.Time
	To             *time.Time
	Limit          int
	Offset         int
}

type BookingStats struct {
	AppointmentsTotal int
}

func adminPage(limit, offset int) (int, int) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func (s *Store) ListAppointmentsAdmin(ctx context.Context, f AppointmentListFilter) ([]domain.Appointment, error) {
	limit, offset := adminPage(f.Limit, f.Offset)
	q := strings.TrimSpace(f.Query)
	like := "%" + q + "%"
	rows, err := s.pool.Query(ctx, `
SELECT `+appointmentCols+`
FROM appointments
WHERE ($1 = '' OR service_name ILIKE $2 OR id::text ILIKE $2)
  AND ($3 = '' OR status = $3)
  AND ($4::uuid IS NULL OR organization_id = $4)
  AND ($5::uuid IS NULL OR master_user_id = $5)
  AND ($6::uuid IS NULL OR client_user_id = $6)
  AND ($7::timestamptz IS NULL OR starts_at >= $7)
  AND ($8::timestamptz IS NULL OR starts_at < $8)
ORDER BY starts_at DESC
LIMIT $9 OFFSET $10`, q, like, strings.TrimSpace(f.Status), f.OrganizationID, f.MasterUserID, f.ClientUserID, f.From, f.To, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanAppointments(rows)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []domain.Appointment{}
	}
	return items, nil
}

func (s *Store) CountAppointmentsAdmin(ctx context.Context, f AppointmentListFilter) (int, error) {
	q := strings.TrimSpace(f.Query)
	like := "%" + q + "%"
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM appointments
WHERE ($1 = '' OR service_name ILIKE $2 OR id::text ILIKE $2)
  AND ($3 = '' OR status = $3)
  AND ($4::uuid IS NULL OR organization_id = $4)
  AND ($5::uuid IS NULL OR master_user_id = $5)
  AND ($6::uuid IS NULL OR client_user_id = $6)
  AND ($7::timestamptz IS NULL OR starts_at >= $7)
  AND ($8::timestamptz IS NULL OR starts_at < $8)`, q, like, strings.TrimSpace(f.Status), f.OrganizationID, f.MasterUserID, f.ClientUserID, f.From, f.To).Scan(&n)
	return n, err
}

func (s *Store) AppointmentStats(ctx context.Context) (BookingStats, error) {
	var st BookingStats
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM appointments`).Scan(&st.AppointmentsTotal)
	return st, err
}
