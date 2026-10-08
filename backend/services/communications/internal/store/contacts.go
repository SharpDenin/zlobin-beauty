package store

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/domain"
)

func (s *Store) InsertContact(ctx context.Context, c domain.Contact) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO contacts(id, owner_user_id, contact_user_id, note, created_at)
VALUES ($1,$2,$3,$4,$5)`,
		c.ID, c.OwnerUserID, c.ContactUserID, c.Note, c.CreatedAt)
	return err
}

func (s *Store) GetContactByOwnerPair(ctx context.Context, ownerID, contactUserID uuid.UUID) (*domain.Contact, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, owner_user_id, contact_user_id, note, created_at
FROM contacts WHERE owner_user_id=$1 AND contact_user_id=$2`, ownerID, contactUserID)
	return scanContact(row)
}

func (s *Store) GetContactForOwner(ctx context.Context, id, ownerID uuid.UUID) (*domain.Contact, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, owner_user_id, contact_user_id, note, created_at
FROM contacts WHERE id=$1 AND owner_user_id=$2`, id, ownerID)
	return scanContact(row)
}

func (s *Store) ListContacts(ctx context.Context, ownerID uuid.UUID, q, role string, limit, offset int) ([]domain.Contact, int, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	q = strings.TrimSpace(q)
	role = strings.TrimSpace(role)
	like := "%" + q + "%"
	var total int
	if err := s.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM contacts WHERE owner_user_id=$1`, ownerID).Scan(&total); err != nil {
		return nil, 0, err
	}
	// q/role filtering happens after identity hydration in the service layer when needed;
	// store returns the owner's page ordered by created_at desc. When q is empty we page in SQL.
	if q == "" && role == "" {
		rows, err := s.pool.Query(ctx, `
SELECT id, owner_user_id, contact_user_id, note, created_at
FROM contacts WHERE owner_user_id=$1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3`, ownerID, limit, offset)
		if err != nil {
			return nil, 0, err
		}
		defer rows.Close()
		items, err := scanContacts(rows)
		return items, total, err
	}
	_ = like
	rows, err := s.pool.Query(ctx, `
SELECT id, owner_user_id, contact_user_id, note, created_at
FROM contacts WHERE owner_user_id=$1
ORDER BY created_at DESC`, ownerID)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items, err := scanContacts(rows)
	return items, total, err
}

func (s *Store) UpdateContactNote(ctx context.Context, id, ownerID uuid.UUID, note string) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE contacts SET note=$3 WHERE id=$1 AND owner_user_id=$2`, id, ownerID, note)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) DeleteContact(ctx context.Context, id, ownerID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `
DELETE FROM contacts WHERE id=$1 AND owner_user_id=$2`, id, ownerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) ListContactUserIDs(ctx context.Context, ownerID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `SELECT contact_user_id FROM contacts WHERE owner_user_id=$1`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	if out == nil {
		out = []uuid.UUID{}
	}
	return out, rows.Err()
}

// FindConversationBetween returns the most recently updated conversation where both users participate.
func (s *Store) FindConversationBetween(ctx context.Context, a, b uuid.UUID) (*uuid.UUID, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
SELECT c.id
FROM conversations c
JOIN conversation_participants p1 ON p1.conversation_id = c.id AND p1.user_id = $1
JOIN conversation_participants p2 ON p2.conversation_id = c.id AND p2.user_id = $2
ORDER BY c.updated_at DESC
LIMIT 1`, a, b).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func scanContact(row interface{ Scan(dest ...any) error }) (*domain.Contact, error) {
	var c domain.Contact
	if err := row.Scan(&c.ID, &c.OwnerUserID, &c.ContactUserID, &c.Note, &c.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &c, nil
}

func scanContacts(rows pgx.Rows) ([]domain.Contact, error) {
	var out []domain.Contact
	for rows.Next() {
		var c domain.Contact
		if err := rows.Scan(&c.ID, &c.OwnerUserID, &c.ContactUserID, &c.Note, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	if out == nil {
		out = []domain.Contact{}
	}
	return out, rows.Err()
}
