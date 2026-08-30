package store

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/domain"
)

type OrgListFilter struct {
	Query        string
	Type         string
	Status       string
	City         string
	Published    *bool
	MemberUserID *uuid.UUID
	Limit        int
	Offset       int
}

type OrgStats struct {
	Total     int
	Active    int
	Published int
	Salons    int
	Suppliers int
}

type OrgListItem struct {
	domain.Organization
	City string
}

func page(limit, offset int) (int, int) {
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

func (s *Store) ListOrgsAdmin(ctx context.Context, f OrgListFilter) ([]OrgListItem, error) {
	limit, offset := page(f.Limit, f.Offset)
	q := strings.TrimSpace(f.Query)
	like := "%" + q + "%"
	city := strings.TrimSpace(f.City)
	cityLike := "%" + city + "%"
	rows, err := s.pool.Query(ctx, `
SELECT o.id, o.name, o.description, o.type, o.status, o.published, o.logo_media_id, o.delivery_note,
       o.masters_see_client_contacts, o.created_by, o.created_at, o.updated_at,
       COALESCE((SELECT b.city FROM branches b WHERE b.organization_id = o.id ORDER BY b.name LIMIT 1), '')
FROM organizations o
WHERE ($1 = '' OR o.name ILIKE $2 OR o.description ILIKE $2)
  AND ($3 = '' OR o.type = $3)
  AND ($4 = '' OR o.status = $4)
  AND ($5 = '' OR EXISTS (SELECT 1 FROM branches b WHERE b.organization_id = o.id AND b.city ILIKE $6))
  AND ($7::bool IS NULL OR o.published = $7)
  AND ($8::uuid IS NULL OR EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = $8))
ORDER BY o.name
LIMIT $9 OFFSET $10`,
		q, like, strings.TrimSpace(f.Type), strings.TrimSpace(f.Status), city, cityLike, f.Published, f.MemberUserID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OrgListItem
	for rows.Next() {
		var item OrgListItem
		if err := rows.Scan(&item.ID, &item.Name, &item.Description, &item.Type, &item.Status, &item.Published,
			&item.LogoMediaID, &item.DeliveryNote, &item.MastersSeeClientContacts, &item.CreatedBy, &item.CreatedAt, &item.UpdatedAt, &item.City); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	if out == nil {
		out = []OrgListItem{}
	}
	return out, rows.Err()
}

func (s *Store) CountOrgsAdmin(ctx context.Context, f OrgListFilter) (int, error) {
	q := strings.TrimSpace(f.Query)
	like := "%" + q + "%"
	city := strings.TrimSpace(f.City)
	cityLike := "%" + city + "%"
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM organizations o
WHERE ($1 = '' OR o.name ILIKE $2 OR o.description ILIKE $2)
  AND ($3 = '' OR o.type = $3)
  AND ($4 = '' OR o.status = $4)
  AND ($5 = '' OR EXISTS (SELECT 1 FROM branches b WHERE b.organization_id = o.id AND b.city ILIKE $6))
  AND ($7::bool IS NULL OR o.published = $7)
  AND ($8::uuid IS NULL OR EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = $8))`,
		q, like, strings.TrimSpace(f.Type), strings.TrimSpace(f.Status), city, cityLike, f.Published, f.MemberUserID).Scan(&n)
	return n, err
}

func (s *Store) OrgStats(ctx context.Context) (OrgStats, error) {
	var st OrgStats
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*)::int,
       COUNT(*) FILTER (WHERE status = 'active')::int,
       COUNT(*) FILTER (WHERE published = TRUE)::int,
       COUNT(*) FILTER (WHERE type = 'salon')::int,
       COUNT(*) FILTER (WHERE type = 'supplier')::int
FROM organizations`).Scan(&st.Total, &st.Active, &st.Published, &st.Salons, &st.Suppliers)
	return st, err
}

func (s *Store) SetOrgPublished(ctx context.Context, id uuid.UUID, published bool, at time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE organizations SET published=$2, updated_at=$3 WHERE id=$1`, id, published, at)
	return err
}
