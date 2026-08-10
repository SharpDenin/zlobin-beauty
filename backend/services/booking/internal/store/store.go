package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

type Store struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

func (s *Store) ReplaceWorkingHours(ctx context.Context, masterUserID uuid.UUID, hours []domain.WorkingHours) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM working_hours WHERE master_user_id=$1`, masterUserID); err != nil {
		return err
	}
	for _, h := range hours {
		if _, err := tx.Exec(ctx, `
INSERT INTO working_hours(id, master_user_id, weekday, start_minute, end_minute)
VALUES ($1,$2,$3,$4,$5)`, h.ID, h.MasterUserID, h.Weekday, h.StartMinute, h.EndMinute); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) ListWorkingHours(ctx context.Context, masterUserID uuid.UUID) ([]domain.WorkingHours, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, master_user_id, weekday, start_minute, end_minute
FROM working_hours WHERE master_user_id=$1 ORDER BY weekday, start_minute`, masterUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.WorkingHours
	for rows.Next() {
		var h domain.WorkingHours
		if err := rows.Scan(&h.ID, &h.MasterUserID, &h.Weekday, &h.StartMinute, &h.EndMinute); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

func (s *Store) ListAppointmentsInRange(ctx context.Context, masterUserID uuid.UUID, from, to time.Time) ([]domain.Appointment, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, organization_id, branch_id, master_user_id, client_user_id, service_id, service_name,
       duration_minutes, price_minor, currency, status, COALESCE(cancel_reason, ''), starts_at, ends_at, created_at, updated_at
FROM appointments
WHERE master_user_id=$1
  AND status IN ('pending_confirmation','confirmed','in_progress')
  AND starts_at < $3 AND ends_at > $2
ORDER BY starts_at`, masterUserID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAppointments(rows)
}

func (s *Store) CreateAppointment(ctx context.Context, a domain.Appointment) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO appointments(
  id, organization_id, branch_id, master_user_id, client_user_id, service_id, service_name,
  duration_minutes, price_minor, currency, status, starts_at, ends_at, created_at, updated_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		a.ID, a.OrganizationID, a.BranchID, a.MasterUserID, a.ClientUserID, a.ServiceID, a.ServiceName,
		a.DurationMinutes, a.PriceMinor, a.Currency, a.Status, a.StartsAt, a.EndsAt, a.CreatedAt, a.UpdatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23P01" {
			return apperr.Conflict("time slot is not available")
		}
		return err
	}
	return nil
}

func (s *Store) GetAppointment(ctx context.Context, id uuid.UUID) (*domain.Appointment, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, organization_id, branch_id, master_user_id, client_user_id, service_id, service_name,
       duration_minutes, price_minor, currency, status, COALESCE(cancel_reason, ''), starts_at, ends_at, created_at, updated_at
FROM appointments WHERE id=$1`, id)
	var a domain.Appointment
	if err := row.Scan(&a.ID, &a.OrganizationID, &a.BranchID, &a.MasterUserID, &a.ClientUserID, &a.ServiceID, &a.ServiceName,
		&a.DurationMinutes, &a.PriceMinor, &a.Currency, &a.Status, &a.CancelReason, &a.StartsAt, &a.EndsAt, &a.CreatedAt, &a.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &a, nil
}

func (s *Store) TransitionStatus(ctx context.Context, id uuid.UUID, from, to string, actor uuid.UUID, reason string, at time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `
UPDATE appointments SET status=$3, cancel_reason=CASE WHEN $3 LIKE 'cancelled%' OR $3='no_show' THEN $4 ELSE cancel_reason END, updated_at=$5
WHERE id=$1 AND status=$2`, id, from, to, reason, at)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.Conflict("appointment status changed concurrently")
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO appointment_status_history(id, appointment_id, from_status, to_status, actor_user_id, reason, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7)`, idsNew(), id, from, to, actor, reason, at); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) Reschedule(ctx context.Context, id uuid.UUID, fromStatus string, starts, ends time.Time, actor uuid.UUID, at time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `
UPDATE appointments SET starts_at=$3, ends_at=$4, updated_at=$5
WHERE id=$1 AND status=$2`, id, fromStatus, starts, ends, at)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23P01" {
			return apperr.Conflict("time slot is not available")
		}
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.Conflict("appointment status changed concurrently")
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO appointment_status_history(id, appointment_id, from_status, to_status, actor_user_id, reason, created_at)
VALUES ($1,$2,$3,$3,$4,$5,$6)`, idsNew(), id, fromStatus, actor, "rescheduled", at); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) ListHistory(ctx context.Context, appointmentID uuid.UUID) ([]domain.StatusHistory, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, appointment_id, from_status, to_status, actor_user_id, reason, created_at
FROM appointment_status_history WHERE appointment_id=$1 ORDER BY created_at`, appointmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.StatusHistory
	for rows.Next() {
		var h domain.StatusHistory
		if err := rows.Scan(&h.ID, &h.AppointmentID, &h.FromStatus, &h.ToStatus, &h.ActorUserID, &h.Reason, &h.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// UpdateStatus kept for backward compatibility during transition; prefer TransitionStatus.
func (s *Store) UpdateStatus(ctx context.Context, id uuid.UUID, status string, at time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE appointments SET status=$2, updated_at=$3 WHERE id=$1`, id, status, at)
	return err
}

func idsNew() uuid.UUID {
	return uuid.Must(uuid.NewV7())
}

func (s *Store) ListForUser(ctx context.Context, userID uuid.UUID, asMaster bool) ([]domain.Appointment, error) {
	col := "client_user_id"
	if asMaster {
		col = "master_user_id"
	}
	rows, err := s.pool.Query(ctx, `
SELECT id, organization_id, branch_id, master_user_id, client_user_id, service_id, service_name,
       duration_minutes, price_minor, currency, status, COALESCE(cancel_reason, ''), starts_at, ends_at, created_at, updated_at
FROM appointments WHERE `+col+`=$1 ORDER BY starts_at DESC LIMIT 100`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAppointments(rows)
}

func scanAppointments(rows pgx.Rows) ([]domain.Appointment, error) {
	var out []domain.Appointment
	for rows.Next() {
		var a domain.Appointment
		if err := rows.Scan(&a.ID, &a.OrganizationID, &a.BranchID, &a.MasterUserID, &a.ClientUserID, &a.ServiceID, &a.ServiceName,
			&a.DurationMinutes, &a.PriceMinor, &a.Currency, &a.Status, &a.CancelReason, &a.StartsAt, &a.EndsAt, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ListByOrgInRange returns appointments for an organization overlapping [from, to).
// Statuses default to confirmed and in_progress for future demand forecasting.
func (s *Store) ListByOrgInRange(ctx context.Context, orgID uuid.UUID, from, to time.Time, statuses []string) ([]domain.Appointment, error) {
	if len(statuses) == 0 {
		statuses = []string{domain.StatusConfirmed, domain.StatusInProgress}
	}
	rows, err := s.pool.Query(ctx, `
SELECT id, organization_id, branch_id, master_user_id, client_user_id, service_id, service_name,
       duration_minutes, price_minor, currency, status, COALESCE(cancel_reason, ''), starts_at, ends_at, created_at, updated_at
FROM appointments
WHERE organization_id=$1
  AND status = ANY($4)
  AND starts_at < $3 AND ends_at > $2
ORDER BY starts_at`, orgID, from, to, statuses)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAppointments(rows)
}

// --- appointment photos ---

const appointmentPhotoCols = `id, appointment_id, media_id, kind, created_by, created_at`

func (s *Store) ListAppointmentPhotos(ctx context.Context, appointmentID uuid.UUID) ([]domain.AppointmentPhoto, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+appointmentPhotoCols+` FROM appointment_photos
WHERE appointment_id=$1 ORDER BY kind ASC, created_at ASC`, appointmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.AppointmentPhoto
	for rows.Next() {
		var p domain.AppointmentPhoto
		if err := rows.Scan(&p.ID, &p.AppointmentID, &p.MediaID, &p.Kind, &p.CreatedBy, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) CreateAppointmentPhoto(ctx context.Context, p domain.AppointmentPhoto) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO appointment_photos(id, appointment_id, media_id, kind, created_by, created_at)
VALUES ($1,$2,$3,$4,$5,$6)`,
		p.ID, p.AppointmentID, p.MediaID, p.Kind, p.CreatedBy, p.CreatedAt)
	return err
}

func (s *Store) GetAppointmentPhoto(ctx context.Context, id uuid.UUID) (*domain.AppointmentPhoto, error) {
	var p domain.AppointmentPhoto
	err := s.pool.QueryRow(ctx, `SELECT `+appointmentPhotoCols+` FROM appointment_photos WHERE id=$1`, id).
		Scan(&p.ID, &p.AppointmentID, &p.MediaID, &p.Kind, &p.CreatedBy, &p.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

func (s *Store) DeleteAppointmentPhoto(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM appointment_photos WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) GetClientAutoConfirm(ctx context.Context, masterUserID, clientUserID uuid.UUID) (bool, error) {
	var auto bool
	err := s.pool.QueryRow(ctx, `
SELECT auto_confirm FROM master_client_settings
WHERE master_user_id=$1 AND client_user_id=$2`, masterUserID, clientUserID).Scan(&auto)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return auto, nil
}

func (s *Store) SetClientAutoConfirm(ctx context.Context, masterUserID, clientUserID uuid.UUID, autoConfirm bool, now time.Time) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO master_client_settings(master_user_id, client_user_id, auto_confirm, created_at, updated_at)
VALUES ($1,$2,$3,$4,$4)
ON CONFLICT (master_user_id, client_user_id) DO UPDATE SET
  auto_confirm=EXCLUDED.auto_confirm,
  updated_at=EXCLUDED.updated_at`, masterUserID, clientUserID, autoConfirm, now)
	return err
}
