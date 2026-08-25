package store

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

const mcCols = `id, instructor_user_id, title, description, category, city, location_note,
starts_at, ends_at, timezone, capacity, status, created_at, updated_at`

func (s *Store) InsertMasterclass(ctx context.Context, e domain.MasterclassEvent) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO masterclass_events(id, instructor_user_id, title, description, category, city, location_note,
  starts_at, ends_at, timezone, capacity, status, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
		e.ID, e.InstructorUserID, e.Title, e.Description, e.Category, e.City, e.LocationNote,
		e.StartsAt, e.EndsAt, e.Timezone, e.Capacity, e.Status, e.CreatedAt, e.UpdatedAt)
	return err
}

func (s *Store) UpdateMasterclass(ctx context.Context, e domain.MasterclassEvent) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE masterclass_events SET title=$2, description=$3, category=$4, city=$5, location_note=$6,
  starts_at=$7, ends_at=$8, timezone=$9, capacity=$10, status=$11, updated_at=$12
WHERE id=$1`, e.ID, e.Title, e.Description, e.Category, e.City, e.LocationNote,
		e.StartsAt, e.EndsAt, e.Timezone, e.Capacity, e.Status, e.UpdatedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("masterclass not found")
	}
	return nil
}

func (s *Store) GetMasterclass(ctx context.Context, id uuid.UUID) (*domain.MasterclassEvent, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+mcCols+` FROM masterclass_events WHERE id=$1`, id)
	e, err := scanMasterclass(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return e, err
}

func (s *Store) ListMasterclasses(ctx context.Context, instructor *uuid.UUID, publishedOnly bool, limit, offset int) ([]domain.MasterclassEvent, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	q := `SELECT ` + mcCols + ` FROM masterclass_events WHERE 1=1`
	args := []any{}
	n := 1
	if publishedOnly {
		q += ` AND status='published'`
	}
	if instructor != nil {
		q += ` AND instructor_user_id=$` + strconv.Itoa(n)
		args = append(args, *instructor)
		n++
	}
	q += ` ORDER BY starts_at ASC LIMIT $` + strconv.Itoa(n) + ` OFFSET $` + strconv.Itoa(n+1)
	args = append(args, limit, offset)
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.MasterclassEvent
	for rows.Next() {
		e, err := scanMasterclass(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *e)
	}
	return out, rows.Err()
}

func (s *Store) CountConfirmedRegistrations(ctx context.Context, eventID uuid.UUID) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*)::int FROM masterclass_registrations
WHERE event_id=$1 AND status IN ('requested','confirmed')`, eventID).Scan(&n)
	return n, err
}

func (s *Store) InsertInterest(ctx context.Context, i domain.MasterclassInterest) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO masterclass_interests(id, master_user_id, category, city, date_from, date_to, location_note, status, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		i.ID, i.MasterUserID, i.Category, i.City, i.DateFrom, i.DateTo, i.LocationNote, i.Status, i.CreatedAt)
	return err
}

func (s *Store) ListInterests(ctx context.Context, userID *uuid.UUID, activeOnly bool) ([]domain.MasterclassInterest, error) {
	q := `SELECT id, master_user_id, category, city, date_from, date_to, location_note, status, created_at
FROM masterclass_interests WHERE 1=1`
	args := []any{}
	n := 1
	if userID != nil {
		q += ` AND master_user_id=$` + strconv.Itoa(n)
		args = append(args, *userID)
		n++
	}
	if activeOnly {
		q += ` AND status='active'`
	}
	q += ` ORDER BY created_at DESC`
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.MasterclassInterest
	for rows.Next() {
		var i domain.MasterclassInterest
		if err := rows.Scan(&i.ID, &i.MasterUserID, &i.Category, &i.City, &i.DateFrom, &i.DateTo, &i.LocationNote, &i.Status, &i.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

func (s *Store) GetRegistration(ctx context.Context, eventID, userID uuid.UUID) (*domain.MasterclassRegistration, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, event_id, master_user_id, status, created_at, updated_at
FROM masterclass_registrations WHERE event_id=$1 AND master_user_id=$2`, eventID, userID)
	r, err := scanReg(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return r, err
}

func (s *Store) GetRegistrationByID(ctx context.Context, id uuid.UUID) (*domain.MasterclassRegistration, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, event_id, master_user_id, status, created_at, updated_at
FROM masterclass_registrations WHERE id=$1`, id)
	r, err := scanReg(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return r, err
}

func (s *Store) ListRegistrations(ctx context.Context, eventID uuid.UUID) ([]domain.MasterclassRegistration, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, event_id, master_user_id, status, created_at, updated_at
FROM masterclass_registrations WHERE event_id=$1 ORDER BY created_at`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.MasterclassRegistration
	for rows.Next() {
		r, err := scanReg(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

func (s *Store) RegisterMasterclass(ctx context.Context, eventID, userID, regID uuid.UUID, now time.Time) (*domain.MasterclassRegistration, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`); err != nil {
		return nil, err
	}
	var capacity int
	var status string
	var instructor uuid.UUID
	if err := tx.QueryRow(ctx, `
SELECT capacity, status, instructor_user_id FROM masterclass_events WHERE id=$1 FOR UPDATE`, eventID).
		Scan(&capacity, &status, &instructor); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperr.NotFound("masterclass not found")
		}
		return nil, err
	}
	if status != domain.StatusPublished {
		return nil, apperr.Conflict("masterclass is not open for registration")
	}
	if instructor == userID {
		return nil, apperr.Forbidden("instructor cannot register for own masterclass")
	}
	var existingID uuid.UUID
	var existingStatus string
	err = tx.QueryRow(ctx, `
SELECT id, status FROM masterclass_registrations WHERE event_id=$1 AND master_user_id=$2`, eventID, userID).
		Scan(&existingID, &existingStatus)
	if err == nil {
		if existingStatus != domain.RegCancelled {
			return nil, apperr.Conflict("already registered")
		}
		var taken int
		if err := tx.QueryRow(ctx, `
SELECT COUNT(*)::int FROM masterclass_registrations
WHERE event_id=$1 AND status IN ('requested','confirmed')`, eventID).Scan(&taken); err != nil {
			return nil, err
		}
		if taken >= capacity {
			return nil, apperr.Conflict("no seats left")
		}
		if _, err := tx.Exec(ctx, `
UPDATE masterclass_registrations SET status='confirmed', updated_at=$2 WHERE id=$1`, existingID, now); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, mapSerialize(err)
		}
		return s.GetRegistrationByID(ctx, existingID)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	var taken int
	if err := tx.QueryRow(ctx, `
SELECT COUNT(*)::int FROM masterclass_registrations
WHERE event_id=$1 AND status IN ('requested','confirmed')`, eventID).Scan(&taken); err != nil {
		return nil, err
	}
	if taken >= capacity {
		return nil, apperr.Conflict("no seats left")
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO masterclass_registrations(id, event_id, master_user_id, status, created_at, updated_at)
VALUES ($1,$2,$3,'confirmed',$4,$4)`, regID, eventID, userID, now); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, apperr.Conflict("already registered")
		}
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, mapSerialize(err)
	}
	return s.GetRegistrationByID(ctx, regID)
}

func (s *Store) CancelRegistration(ctx context.Context, id uuid.UUID, userID uuid.UUID, now time.Time) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE masterclass_registrations SET status='cancelled', updated_at=$3
WHERE id=$1 AND master_user_id=$2 AND status IN ('requested','confirmed')`, id, userID, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("registration not found")
	}
	return nil
}

func (s *Store) InsertModelRequest(ctx context.Context, e domain.ModelRequest) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO model_requests(id, master_user_id, category, title, description, city, location_note,
  starts_at, ends_at, timezone, capacity, accepted_count, status, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		e.ID, e.MasterUserID, e.Category, e.Title, e.Description, e.City, e.LocationNote,
		e.StartsAt, e.EndsAt, e.Timezone, e.Capacity, e.AcceptedCount, e.Status, e.CreatedAt, e.UpdatedAt)
	return err
}

func (s *Store) UpdateModelRequest(ctx context.Context, e domain.ModelRequest) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE model_requests SET category=$2, title=$3, description=$4, city=$5, location_note=$6,
  starts_at=$7, ends_at=$8, timezone=$9, capacity=$10, accepted_count=$11, status=$12, updated_at=$13
WHERE id=$1`, e.ID, e.Category, e.Title, e.Description, e.City, e.LocationNote,
		e.StartsAt, e.EndsAt, e.Timezone, e.Capacity, e.AcceptedCount, e.Status, e.UpdatedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("model request not found")
	}
	return nil
}

func (s *Store) GetModelRequest(ctx context.Context, id uuid.UUID) (*domain.ModelRequest, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, master_user_id, category, title, description, city, location_note,
  starts_at, ends_at, timezone, capacity, accepted_count, status, created_at, updated_at
FROM model_requests WHERE id=$1`, id)
	e, err := scanModelRequest(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return e, err
}

func (s *Store) ListModelRequests(ctx context.Context, master *uuid.UUID, publishedOnly bool, limit, offset int) ([]domain.ModelRequest, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	q := `SELECT id, master_user_id, category, title, description, city, location_note,
starts_at, ends_at, timezone, capacity, accepted_count, status, created_at, updated_at
FROM model_requests WHERE 1=1`
	args := []any{}
	n := 1
	if publishedOnly {
		q += ` AND status='published'`
	}
	if master != nil {
		q += ` AND master_user_id=$` + strconv.Itoa(n)
		args = append(args, *master)
		n++
	}
	q += ` ORDER BY starts_at ASC LIMIT $` + strconv.Itoa(n) + ` OFFSET $` + strconv.Itoa(n+1)
	args = append(args, limit, offset)
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ModelRequest
	for rows.Next() {
		e, err := scanModelRequest(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *e)
	}
	return out, rows.Err()
}

func (s *Store) GetModelResponse(ctx context.Context, requestID, userID uuid.UUID) (*domain.ModelResponse, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, request_id, client_user_id, status, created_at, updated_at
FROM model_responses WHERE request_id=$1 AND client_user_id=$2
ORDER BY created_at DESC LIMIT 1`, requestID, userID)
	r, err := scanModelResp(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return r, err
}

func (s *Store) GetModelResponseByID(ctx context.Context, id uuid.UUID) (*domain.ModelResponse, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, request_id, client_user_id, status, created_at, updated_at
FROM model_responses WHERE id=$1`, id)
	r, err := scanModelResp(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return r, err
}

func (s *Store) ListModelResponses(ctx context.Context, requestID uuid.UUID) ([]domain.ModelResponse, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, request_id, client_user_id, status, created_at, updated_at
FROM model_responses WHERE request_id=$1 ORDER BY created_at`, requestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ModelResponse
	for rows.Next() {
		r, err := scanModelResp(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

func (s *Store) InsertModelResponse(ctx context.Context, r domain.ModelResponse) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO model_responses(id, request_id, client_user_id, status, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6)`, r.ID, r.RequestID, r.ClientUserID, r.Status, r.CreatedAt, r.UpdatedAt)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return apperr.Conflict("already responded")
	}
	return err
}

func (s *Store) AcceptModelResponse(ctx context.Context, responseID, clientID uuid.UUID, now time.Time) (*domain.ModelRequest, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`); err != nil {
		return nil, err
	}
	var reqID uuid.UUID
	var status string
	if err := tx.QueryRow(ctx, `
SELECT request_id, status FROM model_responses WHERE id=$1 AND client_user_id=$2 FOR UPDATE`, responseID, clientID).
		Scan(&reqID, &status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperr.NotFound("response not found")
		}
		return nil, err
	}
	if status == domain.RespAccepted {
		req, err := s.GetModelRequest(ctx, reqID)
		return req, err
	}
	if status != domain.RespRequested {
		return nil, apperr.Conflict("response is not active")
	}
	var capacity, accepted int
	var reqStatus string
	if err := tx.QueryRow(ctx, `
SELECT capacity, accepted_count, status FROM model_requests WHERE id=$1 FOR UPDATE`, reqID).
		Scan(&capacity, &accepted, &reqStatus); err != nil {
		return nil, err
	}
	if reqStatus != domain.StatusPublished {
		return nil, apperr.Conflict("request is not open")
	}
	if accepted >= capacity {
		return nil, apperr.Conflict("no model slots left")
	}
	if _, err := tx.Exec(ctx, `
UPDATE model_responses SET status='accepted', updated_at=$2 WHERE id=$1`, responseID, now); err != nil {
		return nil, err
	}
	newAccepted := accepted + 1
	newStatus := domain.StatusPublished
	if newAccepted >= capacity {
		newStatus = domain.StatusClosed
	}
	if _, err := tx.Exec(ctx, `
UPDATE model_requests SET accepted_count=$2, status=$3, updated_at=$4 WHERE id=$1`, reqID, newAccepted, newStatus, now); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, mapSerialize(err)
	}
	return s.GetModelRequest(ctx, reqID)
}

func (s *Store) CancelModelResponse(ctx context.Context, id, userID uuid.UUID, now time.Time) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE model_responses SET status='cancelled', updated_at=$3
WHERE id=$1 AND client_user_id=$2 AND status='requested'`, id, userID, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("response not found")
	}
	return nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanMasterclass(row scanner) (*domain.MasterclassEvent, error) {
	var e domain.MasterclassEvent
	if err := row.Scan(&e.ID, &e.InstructorUserID, &e.Title, &e.Description, &e.Category, &e.City, &e.LocationNote,
		&e.StartsAt, &e.EndsAt, &e.Timezone, &e.Capacity, &e.Status, &e.CreatedAt, &e.UpdatedAt); err != nil {
		return nil, err
	}
	return &e, nil
}

func scanReg(row scanner) (*domain.MasterclassRegistration, error) {
	var r domain.MasterclassRegistration
	if err := row.Scan(&r.ID, &r.EventID, &r.MasterUserID, &r.Status, &r.CreatedAt, &r.UpdatedAt); err != nil {
		return nil, err
	}
	return &r, nil
}

func scanModelRequest(row scanner) (*domain.ModelRequest, error) {
	var e domain.ModelRequest
	if err := row.Scan(&e.ID, &e.MasterUserID, &e.Category, &e.Title, &e.Description, &e.City, &e.LocationNote,
		&e.StartsAt, &e.EndsAt, &e.Timezone, &e.Capacity, &e.AcceptedCount, &e.Status, &e.CreatedAt, &e.UpdatedAt); err != nil {
		return nil, err
	}
	return &e, nil
}

func scanModelResp(row scanner) (*domain.ModelResponse, error) {
	var r domain.ModelResponse
	if err := row.Scan(&r.ID, &r.RequestID, &r.ClientUserID, &r.Status, &r.CreatedAt, &r.UpdatedAt); err != nil {
		return nil, err
	}
	return &r, nil
}

func mapSerialize(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && (pgErr.Code == "40001" || pgErr.Code == "40P01") {
		return apperr.Conflict("retry")
	}
	return err
}
