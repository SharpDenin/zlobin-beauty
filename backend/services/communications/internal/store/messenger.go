package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/communications/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

func (s *Store) FindConversationByKey(ctx context.Context, key string) (*domain.Conversation, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, type, context_key, context_type, context_id, created_at, updated_at
FROM conversations WHERE context_key=$1`, key)
	c, err := scanConversation(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return c, err
}

func (s *Store) GetConversation(ctx context.Context, id uuid.UUID) (*domain.Conversation, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, type, context_key, context_type, context_id, created_at, updated_at
FROM conversations WHERE id=$1`, id)
	c, err := scanConversation(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return c, err
}

func (s *Store) InsertConversation(ctx context.Context, c domain.Conversation, parts []domain.Participant) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
INSERT INTO conversations(id, type, context_key, context_type, context_id, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		c.ID, c.Type, c.ContextKey, c.ContextType, c.ContextID, c.CreatedAt, c.UpdatedAt); err != nil {
		return err
	}
	for _, p := range parts {
		if _, err := tx.Exec(ctx, `
INSERT INTO conversation_participants(conversation_id, user_id, participant_role, joined_at)
VALUES ($1,$2,$3,$4)`, p.ConversationID, p.UserID, p.ParticipantRole, p.JoinedAt); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) ListConversationsForUser(ctx context.Context, userID uuid.UUID, limit, offset int) ([]domain.Conversation, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := s.pool.Query(ctx, `
SELECT c.id, c.type, c.context_key, c.context_type, c.context_id, c.created_at, c.updated_at
FROM conversations c
JOIN conversation_participants p ON p.conversation_id = c.id
WHERE p.user_id=$1
ORDER BY c.updated_at DESC
LIMIT $2 OFFSET $3`, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Conversation
	for rows.Next() {
		c, err := scanConversation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

func (s *Store) ListParticipants(ctx context.Context, conversationID uuid.UUID) ([]domain.Participant, error) {
	rows, err := s.pool.Query(ctx, `
SELECT conversation_id, user_id, participant_role, joined_at, last_read_at
FROM conversation_participants WHERE conversation_id=$1`, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Participant
	for rows.Next() {
		var p domain.Participant
		if err := rows.Scan(&p.ConversationID, &p.UserID, &p.ParticipantRole, &p.JoinedAt, &p.LastReadAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) IsParticipant(ctx context.Context, conversationID, userID uuid.UUID) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `
SELECT EXISTS(SELECT 1 FROM conversation_participants WHERE conversation_id=$1 AND user_id=$2)`,
		conversationID, userID).Scan(&ok)
	return ok, err
}

func (s *Store) InsertMessage(ctx context.Context, m domain.Message) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	kind := m.Kind
	if kind == "" {
		kind = domain.MessageKindText
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO messages(id, conversation_id, sender_user_id, kind, body, media_id, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		m.ID, m.ConversationID, m.SenderUserID, kind, m.Body, m.MediaID, m.CreatedAt); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE conversations SET updated_at=$2 WHERE id=$1`, m.ConversationID, m.CreatedAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) ListMessages(ctx context.Context, conversationID uuid.UUID, limit int, before *time.Time) ([]domain.Message, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 101 {
		limit = 101
	}
	var rows pgx.Rows
	var err error
	if before != nil {
		rows, err = s.pool.Query(ctx, `
SELECT id, conversation_id, sender_user_id, kind, body, media_id, created_at, edited_at, deleted_at
FROM messages
WHERE conversation_id=$1 AND created_at < $2
ORDER BY created_at DESC, id DESC
LIMIT $3`, conversationID, *before, limit)
	} else {
		rows, err = s.pool.Query(ctx, `
SELECT id, conversation_id, sender_user_id, kind, body, media_id, created_at, edited_at, deleted_at
FROM messages
WHERE conversation_id=$1
ORDER BY created_at DESC, id DESC
LIMIT $2`, conversationID, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var desc []domain.Message
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		desc = append(desc, *m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]domain.Message, 0, len(desc))
	for i := len(desc) - 1; i >= 0; i-- {
		out = append(out, desc[i])
	}
	return out, nil
}

func (s *Store) LastMessage(ctx context.Context, conversationID uuid.UUID) (*domain.Message, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, conversation_id, sender_user_id, kind, body, media_id, created_at, edited_at, deleted_at
FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`, conversationID)
	m, err := scanMessage(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return m, nil
}

func (s *Store) UserCanAccessMedia(ctx context.Context, mediaID, userID uuid.UUID) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1
  FROM messages m
  JOIN conversation_participants p ON p.conversation_id = m.conversation_id
  WHERE m.media_id=$1 AND p.user_id=$2 AND m.deleted_at IS NULL
)`, mediaID, userID).Scan(&ok)
	return ok, err
}

func (s *Store) UnreadCount(ctx context.Context, conversationID, userID uuid.UUID, lastRead *time.Time) (int, error) {
	var n int
	if lastRead == nil {
		err := s.pool.QueryRow(ctx, `
SELECT COUNT(*)::int FROM messages
WHERE conversation_id=$1 AND sender_user_id<>$2 AND deleted_at IS NULL`, conversationID, userID).Scan(&n)
		return n, err
	}
	err := s.pool.QueryRow(ctx, `
SELECT COUNT(*)::int FROM messages
WHERE conversation_id=$1 AND sender_user_id<>$2 AND deleted_at IS NULL AND created_at > $3`,
		conversationID, userID, *lastRead).Scan(&n)
	return n, err
}

func (s *Store) MarkConversationRead(ctx context.Context, conversationID, userID uuid.UUID, at time.Time) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE conversation_participants SET last_read_at=$3
WHERE conversation_id=$1 AND user_id=$2`, conversationID, userID, at)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("conversation not found")
	}
	return nil
}

func scanConversation(row interface{ Scan(dest ...any) error }) (*domain.Conversation, error) {
	var c domain.Conversation
	if err := row.Scan(&c.ID, &c.Type, &c.ContextKey, &c.ContextType, &c.ContextID, &c.CreatedAt, &c.UpdatedAt); err != nil {
		return nil, err
	}
	return &c, nil
}

func scanMessage(row interface{ Scan(dest ...any) error }) (*domain.Message, error) {
	var m domain.Message
	if err := row.Scan(&m.ID, &m.ConversationID, &m.SenderUserID, &m.Kind, &m.Body, &m.MediaID, &m.CreatedAt, &m.EditedAt, &m.DeletedAt); err != nil {
		return nil, err
	}
	if m.Kind == "" {
		m.Kind = domain.MessageKindText
	}
	return &m, nil
}

func NewConversationID() uuid.UUID { return ids.New() }

func NormalizeBody(body string) string {
	return strings.TrimSpace(body)
}
