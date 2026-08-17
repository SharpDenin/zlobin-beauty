package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/domain"
)

func (s *Store) ListMembershipsByOrg(ctx context.Context, orgID uuid.UUID) ([]domain.Membership, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, organization_id, user_id, role, status, created_at
FROM memberships WHERE organization_id=$1 ORDER BY created_at`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Membership
	for rows.Next() {
		var m domain.Membership
		if err := rows.Scan(&m.ID, &m.OrganizationID, &m.UserID, &m.Role, &m.Status, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) SetMembershipStatus(ctx context.Context, orgID, userID uuid.UUID, role, status string) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE memberships SET status=$4 WHERE organization_id=$1 AND user_id=$2 AND role=$3`,
		orgID, userID, role, status)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) AddOrgAudit(ctx context.Context, id, orgID uuid.UUID, actor *uuid.UUID, action, entityType string, entityID *uuid.UUID, meta []byte, at time.Time) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO org_audit_events(id, organization_id, actor_user_id, action, entity_type, entity_id, meta, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`, id, orgID, actor, action, entityType, entityID, string(meta), at)
	return err
}

func (s *Store) UpsertRepresentative(ctx context.Context, r domain.SupplierRepresentative) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `
INSERT INTO supplier_representatives(id, organization_id, user_id, city, territory, active, display_name, email, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
ON CONFLICT (organization_id, user_id) DO UPDATE SET
  city=EXCLUDED.city, territory=EXCLUDED.territory, active=EXCLUDED.active,
  display_name=EXCLUDED.display_name, email=EXCLUDED.email, updated_at=EXCLUDED.updated_at`,
		r.ID, r.OrganizationID, r.UserID, r.City, r.Territory, r.Active, r.DisplayName, r.Email, r.CreatedAt, r.UpdatedAt)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM representative_salon_assignments WHERE representative_id=$1`, r.ID); err != nil {
		return err
	}
	for _, bid := range r.SalonBranchIDs {
		if _, err := tx.Exec(ctx, `
INSERT INTO representative_salon_assignments(representative_id, branch_id) VALUES ($1,$2)
ON CONFLICT DO NOTHING`, r.ID, bid); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func scanRep(row pgx.Row) (*domain.SupplierRepresentative, error) {
	var r domain.SupplierRepresentative
	if err := row.Scan(&r.ID, &r.OrganizationID, &r.UserID, &r.City, &r.Territory, &r.Active, &r.DisplayName, &r.Email, &r.CreatedAt, &r.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

func (s *Store) GetRepresentative(ctx context.Context, id uuid.UUID) (*domain.SupplierRepresentative, error) {
	r, err := scanRep(s.pool.QueryRow(ctx, `
SELECT id, organization_id, user_id, city, territory, active, display_name, email, created_at, updated_at
FROM supplier_representatives WHERE id=$1`, id))
	if err != nil || r == nil {
		return r, err
	}
	r.SalonBranchIDs, err = s.repSalonIDs(ctx, r.ID)
	return r, err
}

func (s *Store) GetRepresentativeByUser(ctx context.Context, orgID, userID uuid.UUID) (*domain.SupplierRepresentative, error) {
	r, err := scanRep(s.pool.QueryRow(ctx, `
SELECT id, organization_id, user_id, city, territory, active, display_name, email, created_at, updated_at
FROM supplier_representatives WHERE organization_id=$1 AND user_id=$2`, orgID, userID))
	if err != nil || r == nil {
		return r, err
	}
	r.SalonBranchIDs, err = s.repSalonIDs(ctx, r.ID)
	return r, err
}

func (s *Store) GetRepresentativeByUserAny(ctx context.Context, userID uuid.UUID) (*domain.SupplierRepresentative, error) {
	r, err := scanRep(s.pool.QueryRow(ctx, `
SELECT id, organization_id, user_id, city, territory, active, display_name, email, created_at, updated_at
FROM supplier_representatives WHERE user_id=$1 AND active=TRUE ORDER BY created_at LIMIT 1`, userID))
	if err != nil || r == nil {
		return r, err
	}
	r.SalonBranchIDs, err = s.repSalonIDs(ctx, r.ID)
	return r, err
}

func (s *Store) ListRepresentatives(ctx context.Context, orgID uuid.UUID) ([]domain.SupplierRepresentative, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, organization_id, user_id, city, territory, active, display_name, email, created_at, updated_at
FROM supplier_representatives WHERE organization_id=$1 ORDER BY city, created_at`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.SupplierRepresentative
	for rows.Next() {
		var r domain.SupplierRepresentative
		if err := rows.Scan(&r.ID, &r.OrganizationID, &r.UserID, &r.City, &r.Territory, &r.Active, &r.DisplayName, &r.Email, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		r.SalonBranchIDs, err = s.repSalonIDs(ctx, r.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) repSalonIDs(ctx context.Context, repID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `SELECT branch_id FROM representative_salon_assignments WHERE representative_id=$1`, repID)
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
	if ids == nil {
		ids = []uuid.UUID{}
	}
	return ids, rows.Err()
}

func (s *Store) CreateTask(ctx context.Context, t domain.RepresentativeTask) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO representative_tasks(id, organization_id, representative_id, branch_id, title, description, kind, expected_result, due_at, priority, status, result_comment, created_by, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		t.ID, t.OrganizationID, t.RepresentativeID, t.BranchID, t.Title, t.Description, t.Kind, t.ExpectedResult, t.DueAt, t.Priority, t.Status, t.ResultComment, t.CreatedBy, t.CreatedAt, t.UpdatedAt)
	return err
}

func (s *Store) UpdateTask(ctx context.Context, t domain.RepresentativeTask) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE representative_tasks SET title=$2, description=$3, branch_id=$4, kind=$5, expected_result=$6, due_at=$7, priority=$8, status=$9, result_comment=$10, updated_at=$11
WHERE id=$1`, t.ID, t.Title, t.Description, t.BranchID, t.Kind, t.ExpectedResult, t.DueAt, t.Priority, t.Status, t.ResultComment, t.UpdatedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func scanTask(row pgx.Row) (*domain.RepresentativeTask, error) {
	var t domain.RepresentativeTask
	if err := row.Scan(&t.ID, &t.OrganizationID, &t.RepresentativeID, &t.BranchID, &t.Title, &t.Description, &t.Kind, &t.ExpectedResult, &t.DueAt, &t.Priority, &t.Status, &t.ResultComment, &t.CreatedBy, &t.CreatedAt, &t.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &t, nil
}

func (s *Store) GetTask(ctx context.Context, id uuid.UUID) (*domain.RepresentativeTask, error) {
	return scanTask(s.pool.QueryRow(ctx, `
SELECT id, organization_id, representative_id, branch_id, title, description, kind, expected_result, due_at, priority, status, result_comment, created_by, created_at, updated_at
FROM representative_tasks WHERE id=$1`, id))
}

func (s *Store) ListTasks(ctx context.Context, orgID uuid.UUID, repID *uuid.UUID) ([]domain.RepresentativeTask, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, organization_id, representative_id, branch_id, title, description, kind, expected_result, due_at, priority, status, result_comment, created_by, created_at, updated_at
FROM representative_tasks
WHERE organization_id=$1 AND ($2::uuid IS NULL OR representative_id=$2)
ORDER BY due_at NULLS LAST, created_at DESC`, orgID, repID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.RepresentativeTask
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

func (s *Store) CreateRoute(ctx context.Context, rt domain.FieldRoute) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `
INSERT INTO field_routes(id, organization_id, representative_id, planned_date, status, total_km, total_minutes, provider, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		rt.ID, rt.OrganizationID, rt.RepresentativeID, rt.PlannedDate, rt.Status, rt.TotalKm, rt.TotalMinutes, rt.Provider, rt.CreatedAt, rt.UpdatedAt)
	if err != nil {
		return err
	}
	for _, st := range rt.Stops {
		if _, err := tx.Exec(ctx, `
INSERT INTO field_route_stops(id, route_id, kind, branch_id, delivery_id, task_id, latitude, longitude, deadline_at, window_start, window_end, priority, expected_duration_min, status, sort_order, km_from_prev, eta_at, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
			st.ID, rt.ID, st.Kind, st.BranchID, st.DeliveryID, st.TaskID, st.Latitude, st.Longitude, st.DeadlineAt, st.WindowStart, st.WindowEnd, st.Priority, st.ExpectedDurationMin, st.Status, st.SortOrder, st.KmFromPrev, st.ETAAt, st.CreatedAt); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) GetRoute(ctx context.Context, id uuid.UUID) (*domain.FieldRoute, error) {
	var rt domain.FieldRoute
	err := s.pool.QueryRow(ctx, `
SELECT id, organization_id, representative_id, planned_date, status, total_km, total_minutes, provider, created_at, updated_at
FROM field_routes WHERE id=$1`, id).Scan(&rt.ID, &rt.OrganizationID, &rt.RepresentativeID, &rt.PlannedDate, &rt.Status, &rt.TotalKm, &rt.TotalMinutes, &rt.Provider, &rt.CreatedAt, &rt.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	stops, err := s.listStops(ctx, rt.ID)
	if err != nil {
		return nil, err
	}
	rt.Stops = stops
	return &rt, nil
}

func (s *Store) ListRoutes(ctx context.Context, orgID uuid.UUID, repID *uuid.UUID) ([]domain.FieldRoute, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, organization_id, representative_id, planned_date, status, total_km, total_minutes, provider, created_at, updated_at
FROM field_routes WHERE organization_id=$1 AND ($2::uuid IS NULL OR representative_id=$2)
ORDER BY planned_date DESC`, orgID, repID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.FieldRoute
	for rows.Next() {
		var rt domain.FieldRoute
		if err := rows.Scan(&rt.ID, &rt.OrganizationID, &rt.RepresentativeID, &rt.PlannedDate, &rt.Status, &rt.TotalKm, &rt.TotalMinutes, &rt.Provider, &rt.CreatedAt, &rt.UpdatedAt); err != nil {
			return nil, err
		}
		rt.Stops, err = s.listStops(ctx, rt.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, rt)
	}
	return out, rows.Err()
}

func (s *Store) listStops(ctx context.Context, routeID uuid.UUID) ([]domain.FieldRouteStop, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, route_id, kind, branch_id, delivery_id, task_id, latitude, longitude, deadline_at, window_start, window_end, priority, expected_duration_min, status, sort_order, km_from_prev, eta_at, created_at
FROM field_route_stops WHERE route_id=$1 ORDER BY sort_order`, routeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.FieldRouteStop
	for rows.Next() {
		var st domain.FieldRouteStop
		if err := rows.Scan(&st.ID, &st.RouteID, &st.Kind, &st.BranchID, &st.DeliveryID, &st.TaskID, &st.Latitude, &st.Longitude, &st.DeadlineAt, &st.WindowStart, &st.WindowEnd, &st.Priority, &st.ExpectedDurationMin, &st.Status, &st.SortOrder, &st.KmFromPrev, &st.ETAAt, &st.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	if out == nil {
		out = []domain.FieldRouteStop{}
	}
	return out, rows.Err()
}

func (s *Store) UpdateStopStatus(ctx context.Context, stopID uuid.UUID, status string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE field_route_stops SET status=$2 WHERE id=$1`, stopID, status)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) GetStopWithRoute(ctx context.Context, stopID uuid.UUID) (*domain.FieldRouteStop, *domain.FieldRoute, error) {
	var st domain.FieldRouteStop
	err := s.pool.QueryRow(ctx, `
SELECT id, route_id, kind, branch_id, delivery_id, task_id, latitude, longitude, deadline_at, window_start, window_end, priority, expected_duration_min, status, sort_order, km_from_prev, eta_at, created_at
FROM field_route_stops WHERE id=$1`, stopID).Scan(
		&st.ID, &st.RouteID, &st.Kind, &st.BranchID, &st.DeliveryID, &st.TaskID, &st.Latitude, &st.Longitude, &st.DeadlineAt, &st.WindowStart, &st.WindowEnd, &st.Priority, &st.ExpectedDurationMin, &st.Status, &st.SortOrder, &st.KmFromPrev, &st.ETAAt, &st.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, nil
		}
		return nil, nil, err
	}
	rt, err := s.GetRoute(ctx, st.RouteID)
	if err != nil {
		return nil, nil, err
	}
	return &st, rt, nil
}

func (s *Store) ListRepTaskStats(ctx context.Context, orgID uuid.UUID, now time.Time) ([]domain.RepTaskStats, error) {
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	dayEnd := dayStart.Add(24 * time.Hour)
	rows, err := s.pool.Query(ctx, `
SELECT representative_id,
  COUNT(*) FILTER (WHERE due_at >= $2 AND due_at < $3),
  COUNT(*) FILTER (WHERE status='done'),
  COUNT(*) FILTER (WHERE status='overdue' OR (status IN ('open','in_progress') AND due_at IS NOT NULL AND due_at < $4)),
  COUNT(*) FILTER (WHERE status IN ('open','in_progress'))
FROM representative_tasks
WHERE organization_id=$1 AND status <> 'cancelled'
GROUP BY representative_id`, orgID, dayStart, dayEnd, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.RepTaskStats
	for rows.Next() {
		var st domain.RepTaskStats
		if err := rows.Scan(&st.RepresentativeID, &st.TasksToday, &st.TasksDone, &st.TasksOverdue, &st.OpenTasks); err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, rows.Err()
}

