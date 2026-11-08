package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/domain"
)

const consultCols = `id, client_user_id, master_user_id, organization_id, client_card_id, status,
  current_version_id, conversation_id, created_at, updated_at`

const versionCols = `id, consultation_id, version_no, status, client_questionnaire, master_assessment, plan,
  client_comment, created_by, submitted_at, sent_at, approved_at, immutable_at, created_at, updated_at`

func scanConsult(row interface{ Scan(dest ...any) error }) (*domain.HairConsultation, error) {
	var c domain.HairConsultation
	if err := row.Scan(&c.ID, &c.ClientUserID, &c.MasterUserID, &c.OrganizationID, &c.ClientCardID, &c.Status,
		&c.CurrentVersionID, &c.ConversationID, &c.CreatedAt, &c.UpdatedAt); err != nil {
		return nil, err
	}
	return &c, nil
}

func scanVersion(row interface{ Scan(dest ...any) error }) (*domain.HairConsultationVersion, error) {
	var v domain.HairConsultationVersion
	if err := row.Scan(&v.ID, &v.ConsultationID, &v.VersionNo, &v.Status, &v.ClientQuestionnaire, &v.MasterAssessment, &v.Plan,
		&v.ClientComment, &v.CreatedBy, &v.SubmittedAt, &v.SentAt, &v.ApprovedAt, &v.ImmutableAt, &v.CreatedAt, &v.UpdatedAt); err != nil {
		return nil, err
	}
	if v.ClientQuestionnaire == nil {
		v.ClientQuestionnaire = json.RawMessage(`{}`)
	}
	if v.MasterAssessment == nil {
		v.MasterAssessment = json.RawMessage(`{}`)
	}
	if v.Plan == nil {
		v.Plan = json.RawMessage(`{}`)
	}
	return &v, nil
}

func (s *Store) InsertHairConsultation(ctx context.Context, c domain.HairConsultation, v domain.HairConsultationVersion, ev domain.HairConsultationEvent) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Insert consultation without current_version_id first (FK to versions).
	if _, err := tx.Exec(ctx, `
INSERT INTO hair_consultations(id, client_user_id, master_user_id, organization_id, client_card_id, status,
  current_version_id, conversation_id, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9)`,
		c.ID, c.ClientUserID, c.MasterUserID, c.OrganizationID, c.ClientCardID, c.Status,
		c.ConversationID, c.CreatedAt, c.UpdatedAt); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO hair_consultation_versions(id, consultation_id, version_no, status, client_questionnaire, master_assessment, plan,
  client_comment, created_by, submitted_at, sent_at, approved_at, immutable_at, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		v.ID, c.ID, v.VersionNo, v.Status, v.ClientQuestionnaire, v.MasterAssessment, v.Plan,
		v.ClientComment, v.CreatedBy, v.SubmittedAt, v.SentAt, v.ApprovedAt, v.ImmutableAt, v.CreatedAt, v.UpdatedAt); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
UPDATE hair_consultations SET current_version_id=$2 WHERE id=$1`, c.ID, v.ID); err != nil {
		return err
	}
	if err := insertEventTx(ctx, tx, ev); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func insertEventTx(ctx context.Context, tx pgx.Tx, ev domain.HairConsultationEvent) error {
	if ev.Meta == nil {
		ev.Meta = json.RawMessage(`{}`)
	}
	_, err := tx.Exec(ctx, `
INSERT INTO hair_consultation_events(id, consultation_id, version_id, actor_user_id, action, from_status, to_status, meta, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		ev.ID, ev.ConsultationID, ev.VersionID, ev.ActorUserID, ev.Action, ev.FromStatus, ev.ToStatus, ev.Meta, ev.CreatedAt)
	return err
}

func (s *Store) GetHairConsultation(ctx context.Context, id uuid.UUID) (*domain.HairConsultation, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+consultCols+` FROM hair_consultations WHERE id=$1`, id)
	c, err := scanConsult(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return c, err
}

func (s *Store) GetHairConsultationVersion(ctx context.Context, id uuid.UUID) (*domain.HairConsultationVersion, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+versionCols+` FROM hair_consultation_versions WHERE id=$1`, id)
	v, err := scanVersion(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return v, err
}

func (s *Store) ListHairConsultationsForUser(ctx context.Context, userID uuid.UUID, asMaster bool, limit, offset int) ([]domain.HairConsultation, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	q := `SELECT ` + consultCols + ` FROM hair_consultations WHERE client_user_id=$1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3`
	args := []any{userID, limit, offset}
	if asMaster {
		q = `SELECT ` + consultCols + ` FROM hair_consultations WHERE master_user_id=$1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3`
	}
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.HairConsultation
	for rows.Next() {
		c, err := scanConsult(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	if out == nil {
		out = []domain.HairConsultation{}
	}
	return out, rows.Err()
}

// ListHairConsultationsForClientOnCard returns consultations for a client user,
// optionally narrowed to a specific card id when set on the row.
func (s *Store) ListHairConsultationsForClientOnCard(ctx context.Context, clientUserID uuid.UUID, cardID *uuid.UUID, limit int) ([]domain.HairConsultation, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `
SELECT `+consultCols+` FROM hair_consultations
WHERE client_user_id=$1
  AND ($2::uuid IS NULL OR client_card_id IS NULL OR client_card_id=$2)
ORDER BY updated_at DESC LIMIT $3`, clientUserID, cardID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.HairConsultation
	for rows.Next() {
		c, err := scanConsult(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	if out == nil {
		out = []domain.HairConsultation{}
	}
	return out, rows.Err()
}

func (s *Store) FindClientCardID(ctx context.Context, orgID, clientUserID uuid.UUID) (*uuid.UUID, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
SELECT id FROM client_cards WHERE organization_id=$1 AND user_id=$2`, orgID, clientUserID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func (s *Store) ListHairConsultationVersions(ctx context.Context, consultationID uuid.UUID) ([]domain.HairConsultationVersion, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+versionCols+` FROM hair_consultation_versions
WHERE consultation_id=$1 ORDER BY version_no ASC`, consultationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.HairConsultationVersion
	for rows.Next() {
		v, err := scanVersion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	if out == nil {
		out = []domain.HairConsultationVersion{}
	}
	return out, rows.Err()
}

func (s *Store) ListHairConsultationEvents(ctx context.Context, consultationID uuid.UUID) ([]domain.HairConsultationEvent, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, consultation_id, version_id, actor_user_id, action, from_status, to_status, meta, created_at
FROM hair_consultation_events WHERE consultation_id=$1 ORDER BY created_at ASC`, consultationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.HairConsultationEvent
	for rows.Next() {
		var e domain.HairConsultationEvent
		if err := rows.Scan(&e.ID, &e.ConsultationID, &e.VersionID, &e.ActorUserID, &e.Action, &e.FromStatus, &e.ToStatus, &e.Meta, &e.CreatedAt); err != nil {
			return nil, err
		}
		if e.Meta == nil {
			e.Meta = json.RawMessage(`{}`)
		}
		out = append(out, e)
	}
	if out == nil {
		out = []domain.HairConsultationEvent{}
	}
	return out, rows.Err()
}

func (s *Store) ListHairConsultationMedia(ctx context.Context, versionID uuid.UUID) ([]domain.HairConsultationMedia, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, version_id, media_id, slot, uploaded_by, created_at
FROM hair_consultation_media WHERE version_id=$1 ORDER BY created_at ASC`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.HairConsultationMedia
	for rows.Next() {
		var m domain.HairConsultationMedia
		if err := rows.Scan(&m.ID, &m.VersionID, &m.MediaID, &m.Slot, &m.UploadedBy, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	if out == nil {
		out = []domain.HairConsultationMedia{}
	}
	return out, rows.Err()
}

func (s *Store) ListHairConsultationMediaByMediaID(ctx context.Context, mediaID uuid.UUID) ([]domain.HairConsultationMedia, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, version_id, media_id, slot, uploaded_by, created_at
FROM hair_consultation_media WHERE media_id=$1`, mediaID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.HairConsultationMedia
	for rows.Next() {
		var m domain.HairConsultationMedia
		if err := rows.Scan(&m.ID, &m.VersionID, &m.MediaID, &m.Slot, &m.UploadedBy, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) UpdateHairConsultationVersionFields(ctx context.Context, v domain.HairConsultationVersion, touchConsult bool) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `
UPDATE hair_consultation_versions SET
  client_questionnaire=$2, master_assessment=$3, plan=$4, client_comment=$5, updated_at=$6
WHERE id=$1 AND immutable_at IS NULL AND status NOT IN ('approved','superseded')`,
		v.ID, v.ClientQuestionnaire, v.MasterAssessment, v.Plan, v.ClientComment, v.UpdatedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	if touchConsult {
		if _, err := tx.Exec(ctx, `UPDATE hair_consultations SET updated_at=$2 WHERE id=$1`, v.ConsultationID, v.UpdatedAt); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

type ConsultTransition struct {
	EventID        uuid.UUID
	ConsultID      uuid.UUID
	VersionID      uuid.UUID
	ConsultFrom    string
	ConsultTo      string
	VersionFrom    string
	VersionTo      string
	Actor          uuid.UUID
	Action         string
	Now            time.Time
	SubmittedAt    *time.Time
	SentAt         *time.Time
	ApprovedAt     *time.Time
	ImmutableAt    *time.Time
	ClientComment  *string
	ConversationID *uuid.UUID
	Meta           json.RawMessage
	// Optional: supersede another version and insert a new draft version.
	SupersedeVersionID *uuid.UUID
	NewVersion         *domain.HairConsultationVersion
}

func (s *Store) ApplyHairConsultationTransition(ctx context.Context, in ConsultTransition) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`); err != nil {
		return err
	}

	var curStatus, verStatus string
	var immutable *time.Time
	if err := tx.QueryRow(ctx, `
SELECT c.status, v.status, v.immutable_at
FROM hair_consultations c
JOIN hair_consultation_versions v ON v.id=$2
WHERE c.id=$1 AND v.consultation_id=c.id
FOR UPDATE OF c, v`, in.ConsultID, in.VersionID).Scan(&curStatus, &verStatus, &immutable); err != nil {
		return err
	}
	if curStatus != in.ConsultFrom || verStatus != in.VersionFrom {
		return errConflictState
	}
	if immutable != nil && in.NewVersion == nil {
		return errImmutable
	}

	supersedeSame := in.SupersedeVersionID != nil && *in.SupersedeVersionID == in.VersionID
	if in.SupersedeVersionID != nil {
		if _, err := tx.Exec(ctx, `
UPDATE hair_consultation_versions SET status='superseded', immutable_at=COALESCE(immutable_at,$2), updated_at=$2
WHERE id=$1`, *in.SupersedeVersionID, in.Now); err != nil {
			return err
		}
	}

	// When superseding the locked row and inserting a new draft, skip re-writing the old version status.
	if !supersedeSame {
		if _, err := tx.Exec(ctx, `
UPDATE hair_consultation_versions SET
  status=$2,
  updated_at=$3,
  submitted_at=COALESCE($4, submitted_at),
  sent_at=COALESCE($5, sent_at),
  approved_at=COALESCE($6, approved_at),
  immutable_at=COALESCE($7, immutable_at),
  client_comment=COALESCE($8, client_comment)
WHERE id=$1`,
			in.VersionID, in.VersionTo, in.Now, in.SubmittedAt, in.SentAt, in.ApprovedAt, in.ImmutableAt, in.ClientComment); err != nil {
			return err
		}
	}

	currentVersion := in.VersionID
	if in.NewVersion != nil {
		nv := *in.NewVersion
		if _, err := tx.Exec(ctx, `
INSERT INTO hair_consultation_versions(id, consultation_id, version_no, status, client_questionnaire, master_assessment, plan,
  client_comment, created_by, submitted_at, sent_at, approved_at, immutable_at, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
			nv.ID, nv.ConsultationID, nv.VersionNo, nv.Status, nv.ClientQuestionnaire, nv.MasterAssessment, nv.Plan,
			nv.ClientComment, nv.CreatedBy, nv.SubmittedAt, nv.SentAt, nv.ApprovedAt, nv.ImmutableAt, nv.CreatedAt, nv.UpdatedAt); err != nil {
			return err
		}
		currentVersion = nv.ID
	}

	if in.ConversationID != nil {
		if _, err := tx.Exec(ctx, `
UPDATE hair_consultations SET status=$2, current_version_id=$3, conversation_id=$4, updated_at=$5 WHERE id=$1`,
			in.ConsultID, in.ConsultTo, currentVersion, *in.ConversationID, in.Now); err != nil {
			return err
		}
	} else if _, err := tx.Exec(ctx, `
UPDATE hair_consultations SET status=$2, current_version_id=$3, updated_at=$4 WHERE id=$1`,
		in.ConsultID, in.ConsultTo, currentVersion, in.Now); err != nil {
		return err
	}

	from := in.ConsultFrom
	ev := domain.HairConsultationEvent{
		ID: in.EventID, ConsultationID: in.ConsultID, VersionID: &currentVersion,
		ActorUserID: in.Actor, Action: in.Action, FromStatus: &from, ToStatus: in.ConsultTo,
		Meta: in.Meta, CreatedAt: in.Now,
	}
	if err := insertEventTx(ctx, tx, ev); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

var (
	errConflictState = errors.New("consultation state conflict")
	errImmutable     = errors.New("consultation version immutable")
)

func (s *Store) AttachHairConsultationMedia(ctx context.Context, m domain.HairConsultationMedia, replaceSlot bool) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var immutable *time.Time
	var status string
	if err := tx.QueryRow(ctx, `
SELECT immutable_at, status FROM hair_consultation_versions WHERE id=$1 FOR UPDATE`, m.VersionID).
		Scan(&immutable, &status); err != nil {
		return err
	}
	if immutable != nil || status == domain.VerApproved || status == domain.VerSuperseded {
		return errImmutable
	}
	if replaceSlot && m.Slot != domain.SlotReference {
		if _, err := tx.Exec(ctx, `DELETE FROM hair_consultation_media WHERE version_id=$1 AND slot=$2`, m.VersionID, m.Slot); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO hair_consultation_media(id, version_id, media_id, slot, uploaded_by, created_at)
VALUES ($1,$2,$3,$4,$5,$6)
ON CONFLICT (version_id, media_id) DO NOTHING`,
		m.ID, m.VersionID, m.MediaID, m.Slot, m.UploadedBy, m.CreatedAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) DetachHairConsultationMedia(ctx context.Context, versionID, mediaID uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var immutable *time.Time
	var status string
	if err := tx.QueryRow(ctx, `
SELECT immutable_at, status FROM hair_consultation_versions WHERE id=$1 FOR UPDATE`, versionID).
		Scan(&immutable, &status); err != nil {
		return err
	}
	if immutable != nil || status == domain.VerApproved || status == domain.VerSuperseded {
		return errImmutable
	}
	tag, err := tx.Exec(ctx, `DELETE FROM hair_consultation_media WHERE version_id=$1 AND media_id=$2`, versionID, mediaID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return tx.Commit(ctx)
}

func (s *Store) SetHairConsultationConversation(ctx context.Context, id, conversationID uuid.UUID, now time.Time) error {
	_, err := s.pool.Exec(ctx, `
UPDATE hair_consultations SET conversation_id=$2, updated_at=$3 WHERE id=$1`, id, conversationID, now)
	return err
}

func (s *Store) NextHairConsultationVersionNo(ctx context.Context, consultationID uuid.UUID) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
SELECT COALESCE(MAX(version_no), 0) + 1 FROM hair_consultation_versions WHERE consultation_id=$1`, consultationID).Scan(&n)
	return n, err
}

func (s *Store) GetHairConsultationByVersionID(ctx context.Context, versionID uuid.UUID) (*domain.HairConsultation, error) {
	row := s.pool.QueryRow(ctx, `
SELECT `+consultCols+`
FROM hair_consultations c
JOIN hair_consultation_versions v ON v.consultation_id = c.id
WHERE v.id=$1`, versionID)
	c, err := scanConsult(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return c, err
}

func (s *Store) InsertHairConsultationEvent(ctx context.Context, ev domain.HairConsultationEvent) error {
	return insertEventTxStandalone(ctx, s, ev)
}

func insertEventTxStandalone(ctx context.Context, s *Store, ev domain.HairConsultationEvent) error {
	if ev.Meta == nil {
		ev.Meta = json.RawMessage(`{}`)
	}
	_, err := s.pool.Exec(ctx, `
INSERT INTO hair_consultation_events(id, consultation_id, version_id, actor_user_id, action, from_status, to_status, meta, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		ev.ID, ev.ConsultationID, ev.VersionID, ev.ActorUserID, ev.Action, ev.FromStatus, ev.ToStatus, ev.Meta, ev.CreatedAt)
	return err
}

func IsConsultConflict(err error) bool {
	return errors.Is(err, errConflictState)
}

func IsConsultImmutable(err error) bool {
	return errors.Is(err, errImmutable)
}
