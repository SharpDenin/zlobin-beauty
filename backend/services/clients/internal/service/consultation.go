package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

func (s *Service) WithCommunications(url string) *Service {
	s.communicationsURL = strings.TrimRight(url, "/")
	return s
}

type CreateHairConsultationInput struct {
	MasterUserID   uuid.UUID
	OrganizationID *uuid.UUID
	ClientCardID   *uuid.UUID
}

func (s *Service) CreateHairConsultation(ctx context.Context, actor uuid.UUID, in CreateHairConsultationInput) (*domain.HairConsultation, error) {
	if actor == uuid.Nil {
		return nil, apperr.Unauthorized("authentication required")
	}
	if in.MasterUserID == uuid.Nil {
		return nil, apperr.Validation("master_user_id is required")
	}
	if in.MasterUserID == actor {
		return nil, apperr.Validation("cannot create consultation with yourself")
	}
	// Resolve master's solo/salon org when the client did not pass organization_id.
	// Services always belong to an organization in marketplace; private masters still have one.
	if in.OrganizationID == nil {
		if orgID, err := s.lookupMasterOrganization(ctx, in.MasterUserID); err == nil && orgID != nil {
			in.OrganizationID = orgID
		}
	}
	// Link to existing CRM card when possible so diagnostics appear under Analyses.
	if in.ClientCardID == nil && in.OrganizationID != nil {
		if cardID, err := s.store.FindClientCardID(ctx, *in.OrganizationID, actor); err == nil && cardID != nil {
			in.ClientCardID = cardID
		}
	}
	now := s.now().UTC()
	cid := ids.New()
	vid := ids.New()
	c := domain.HairConsultation{
		ID: cid, ClientUserID: actor, MasterUserID: in.MasterUserID,
		OrganizationID: in.OrganizationID, ClientCardID: in.ClientCardID,
		Status: domain.ConsultDraft, CurrentVersionID: &vid, CreatedAt: now, UpdatedAt: now,
	}
	v := domain.HairConsultationVersion{
		ID: vid, ConsultationID: cid, VersionNo: 1, Status: domain.VerDraft,
		ClientQuestionnaire: json.RawMessage(`{}`), MasterAssessment: json.RawMessage(`{}`), Plan: json.RawMessage(`{}`),
		CreatedBy: actor, CreatedAt: now, UpdatedAt: now,
	}
	to := domain.ConsultDraft
	ev := domain.HairConsultationEvent{
		ID: ids.New(), ConsultationID: cid, VersionID: &vid, ActorUserID: actor,
		Action: "created", ToStatus: to, Meta: json.RawMessage(`{}`), CreatedAt: now,
	}
	if err := s.store.InsertHairConsultation(ctx, c, v, ev); err != nil {
		return nil, apperr.Internal(err)
	}
	return s.loadConsultation(ctx, cid, actor)
}

func (s *Service) ListHairConsultations(ctx context.Context, actor uuid.UUID, asMaster bool) ([]domain.HairConsultation, error) {
	if actor == uuid.Nil {
		return nil, apperr.Unauthorized("authentication required")
	}
	items, err := s.store.ListHairConsultationsForUser(ctx, actor, asMaster, 50, 0)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	for i := range items {
		if items[i].CurrentVersionID != nil {
			v, err := s.store.GetHairConsultationVersion(ctx, *items[i].CurrentVersionID)
			if err != nil {
				return nil, apperr.Internal(err)
			}
			items[i].CurrentVersion = v
		}
	}
	return items, nil
}

// ListConsultationsForCard returns diagnostics linked to the card's client (shared SoT).
func (s *Service) ListConsultationsForCard(ctx context.Context, cardID, actor uuid.UUID) ([]domain.HairConsultation, error) {
	card, err := s.GetCard(ctx, cardID, actor)
	if err != nil {
		return nil, err
	}
	cid := card.ID
	items, err := s.store.ListHairConsultationsForClientOnCard(ctx, card.UserID, &cid, 50)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	for i := range items {
		if items[i].CurrentVersionID != nil {
			v, err := s.store.GetHairConsultationVersion(ctx, *items[i].CurrentVersionID)
			if err != nil {
				return nil, apperr.Internal(err)
			}
			items[i].CurrentVersion = v
		}
	}
	return items, nil
}

func (s *Service) GetHairConsultation(ctx context.Context, id, actor uuid.UUID) (*domain.HairConsultation, error) {
	return s.loadConsultation(ctx, id, actor)
}

func (s *Service) loadConsultation(ctx context.Context, id, actor uuid.UUID) (*domain.HairConsultation, error) {
	c, err := s.requireParticipant(ctx, id, actor)
	if err != nil {
		return nil, err
	}
	versions, err := s.store.ListHairConsultationVersions(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	for i := range versions {
		media, err := s.store.ListHairConsultationMedia(ctx, versions[i].ID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		versions[i].Media = media
	}
	c.Versions = versions
	if c.CurrentVersionID != nil {
		for i := range versions {
			if versions[i].ID == *c.CurrentVersionID {
				cv := versions[i]
				c.CurrentVersion = &cv
				break
			}
		}
	}
	events, err := s.store.ListHairConsultationEvents(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	c.Events = events
	return c, nil
}

func (s *Service) requireParticipant(ctx context.Context, id, actor uuid.UUID) (*domain.HairConsultation, error) {
	if actor == uuid.Nil {
		return nil, apperr.Unauthorized("authentication required")
	}
	c, err := s.store.GetHairConsultation(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if c == nil {
		return nil, apperr.NotFound("consultation not found")
	}
	if c.ClientUserID != actor && c.MasterUserID != actor {
		return nil, apperr.Forbidden("access denied")
	}
	return c, nil
}

func (s *Service) requireClient(c *domain.HairConsultation, actor uuid.UUID) error {
	if c.ClientUserID != actor {
		return apperr.Forbidden("only the client can perform this action")
	}
	return nil
}

func (s *Service) requireMaster(c *domain.HairConsultation, actor uuid.UUID) error {
	if c.MasterUserID != actor {
		return apperr.Forbidden("only the assigned master can perform this action")
	}
	return nil
}

func (s *Service) currentVersion(ctx context.Context, c *domain.HairConsultation) (*domain.HairConsultationVersion, error) {
	if c.CurrentVersionID == nil {
		return nil, apperr.Conflict("consultation has no current version")
	}
	v, err := s.store.GetHairConsultationVersion(ctx, *c.CurrentVersionID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if v == nil {
		return nil, apperr.NotFound("version not found")
	}
	return v, nil
}

type PatchQuestionnaireInput struct {
	Questionnaire json.RawMessage
}

func (s *Service) PatchQuestionnaire(ctx context.Context, id, actor uuid.UUID, in PatchQuestionnaireInput) (*domain.HairConsultation, error) {
	c, err := s.requireParticipant(ctx, id, actor)
	if err != nil {
		return nil, err
	}
	if err := s.requireClient(c, actor); err != nil {
		return nil, err
	}
	v, err := s.currentVersion(ctx, c)
	if err != nil {
		return nil, err
	}
	if domain.VersionImmutable(v) {
		return nil, apperr.Conflict("version is immutable")
	}
	if v.Status != domain.VerDraft {
		return nil, apperr.Conflict("questionnaire can only be edited in draft version")
	}
	if c.Status != domain.ConsultDraft {
		return nil, apperr.Conflict("questionnaire can only be edited while consultation is draft")
	}
	q := normalizeJSON(in.Questionnaire)
	now := s.now().UTC()
	v.ClientQuestionnaire = q
	v.UpdatedAt = now
	if err := s.store.UpdateHairConsultationVersionFields(ctx, *v, true); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperr.Conflict("version is immutable")
		}
		return nil, apperr.Internal(err)
	}
	_ = s.store.InsertHairConsultationEvent(ctx, domain.HairConsultationEvent{
		ID: ids.New(), ConsultationID: c.ID, VersionID: &v.ID, ActorUserID: actor,
		Action: "questionnaire_updated", ToStatus: c.Status, Meta: json.RawMessage(`{}`), CreatedAt: now,
	})
	return s.loadConsultation(ctx, id, actor)
}

type PatchAssessmentInput struct {
	Assessment json.RawMessage
}

func (s *Service) PatchAssessment(ctx context.Context, id, actor uuid.UUID, in PatchAssessmentInput) (*domain.HairConsultation, error) {
	c, err := s.requireParticipant(ctx, id, actor)
	if err != nil {
		return nil, err
	}
	if err := s.requireMaster(c, actor); err != nil {
		return nil, err
	}
	v, err := s.currentVersion(ctx, c)
	if err != nil {
		return nil, err
	}
	if domain.VersionImmutable(v) {
		return nil, apperr.Conflict("version is immutable")
	}
	switch v.Status {
	case domain.VerDraft, domain.VerInReview, domain.VerSubmitted:
		// ok
	default:
		return nil, apperr.Conflict("assessment cannot be edited in current version status")
	}
	if c.Status != domain.ConsultInProgress {
		return nil, apperr.Conflict("assessment can only be edited while work is in progress")
	}
	now := s.now().UTC()
	v.MasterAssessment = normalizeJSON(in.Assessment)
	v.UpdatedAt = now
	if err := s.store.UpdateHairConsultationVersionFields(ctx, *v, true); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperr.Conflict("version is immutable")
		}
		return nil, apperr.Internal(err)
	}
	_ = s.store.InsertHairConsultationEvent(ctx, domain.HairConsultationEvent{
		ID: ids.New(), ConsultationID: c.ID, VersionID: &v.ID, ActorUserID: actor,
		Action: "assessment_updated", ToStatus: c.Status, Meta: json.RawMessage(`{}`), CreatedAt: now,
	})
	return s.loadConsultation(ctx, id, actor)
}

type PatchPlanInput struct {
	Plan json.RawMessage
}

func (s *Service) PatchPlan(ctx context.Context, id, actor uuid.UUID, in PatchPlanInput) (*domain.HairConsultation, error) {
	c, err := s.requireParticipant(ctx, id, actor)
	if err != nil {
		return nil, err
	}
	if err := s.requireMaster(c, actor); err != nil {
		return nil, err
	}
	v, err := s.currentVersion(ctx, c)
	if err != nil {
		return nil, err
	}
	if domain.VersionImmutable(v) {
		return nil, apperr.Conflict("version is immutable")
	}
	switch v.Status {
	case domain.VerDraft, domain.VerInReview, domain.VerSubmitted:
		// ok
	default:
		return nil, apperr.Conflict("plan cannot be edited in current version status")
	}
	if c.Status != domain.ConsultInProgress {
		return nil, apperr.Conflict("plan can only be edited while work is in progress")
	}
	now := s.now().UTC()
	plan, err := s.normalizePlanPrices(ctx, in.Plan)
	if err != nil {
		return nil, err
	}
	v.Plan = plan
	v.UpdatedAt = now
	if err := s.store.UpdateHairConsultationVersionFields(ctx, *v, true); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperr.Conflict("version is immutable")
		}
		return nil, apperr.Internal(err)
	}
	_ = s.store.InsertHairConsultationEvent(ctx, domain.HairConsultationEvent{
		ID: ids.New(), ConsultationID: c.ID, VersionID: &v.ID, ActorUserID: actor,
		Action: "plan_updated", ToStatus: c.Status, Meta: json.RawMessage(`{}`), CreatedAt: now,
	})
	return s.loadConsultation(ctx, id, actor)
}

func (s *Service) SubmitHairConsultation(ctx context.Context, id, actor uuid.UUID) (*domain.HairConsultation, error) {
	c, err := s.requireParticipant(ctx, id, actor)
	if err != nil {
		return nil, err
	}
	if err := s.requireClient(c, actor); err != nil {
		return nil, err
	}
	if c.Status == domain.ConsultAwaitingMaster {
		return s.loadConsultation(ctx, id, actor) // idempotent
	}
	v, err := s.currentVersion(ctx, c)
	if err != nil {
		return nil, err
	}
	if c.Status != domain.ConsultDraft || v.Status != domain.VerDraft {
		return nil, apperr.Conflict("consultation cannot be submitted from current status")
	}
	if err := validateQuestionnaireForSubmit(v.ClientQuestionnaire); err != nil {
		return nil, err
	}
	media, err := s.store.ListHairConsultationMedia(ctx, v.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if !hasSlot(media, domain.SlotOverview) {
		return nil, apperr.Validation("overview photo is required to submit")
	}
	now := s.now().UTC()
	if err := s.store.ApplyHairConsultationTransition(ctx, store.ConsultTransition{
		EventID: ids.New(), ConsultID: c.ID, VersionID: v.ID,
		ConsultFrom: domain.ConsultDraft, ConsultTo: domain.ConsultAwaitingMaster,
		VersionFrom: domain.VerDraft, VersionTo: domain.VerSubmitted,
		Actor: actor, Action: "questionnaire_submitted", Now: now, SubmittedAt: &now,
	}); err != nil {
		return s.mapTransitionErr(ctx, id, actor, err)
	}
	s.notify(ctx, c.MasterUserID, "hair_consultation", "Новая анкета на консультацию",
		"Клиент отправил анкету по волосам", "hair_consultation", c.ID)
	return s.loadConsultation(ctx, id, actor)
}

func (s *Service) StartHairConsultation(ctx context.Context, id, actor uuid.UUID) (*domain.HairConsultation, error) {
	c, err := s.requireParticipant(ctx, id, actor)
	if err != nil {
		return nil, err
	}
	if err := s.requireMaster(c, actor); err != nil {
		return nil, err
	}
	if c.Status == domain.ConsultInProgress {
		return s.loadConsultation(ctx, id, actor)
	}
	v, err := s.currentVersion(ctx, c)
	if err != nil {
		return nil, err
	}
	if c.Status != domain.ConsultAwaitingMaster || v.Status != domain.VerSubmitted {
		return nil, apperr.Conflict("consultation cannot be started from current status")
	}
	now := s.now().UTC()
	if err := s.store.ApplyHairConsultationTransition(ctx, store.ConsultTransition{
		EventID: ids.New(), ConsultID: c.ID, VersionID: v.ID,
		ConsultFrom: domain.ConsultAwaitingMaster, ConsultTo: domain.ConsultInProgress,
		VersionFrom: domain.VerSubmitted, VersionTo: domain.VerInReview,
		Actor: actor, Action: "work_started", Now: now,
	}); err != nil {
		return s.mapTransitionErr(ctx, id, actor, err)
	}
	return s.loadConsultation(ctx, id, actor)
}

type SendPlanInput struct {
	ConversationID *uuid.UUID
}

func (s *Service) SendHairConsultationPlan(ctx context.Context, id, actor uuid.UUID, in SendPlanInput) (*domain.HairConsultation, error) {
	c, err := s.requireParticipant(ctx, id, actor)
	if err != nil {
		return nil, err
	}
	if err := s.requireMaster(c, actor); err != nil {
		return nil, err
	}
	if c.Status == domain.ConsultAwaitingClient {
		return s.loadConsultation(ctx, id, actor)
	}
	v, err := s.currentVersion(ctx, c)
	if err != nil {
		return nil, err
	}
	if c.Status != domain.ConsultInProgress {
		return nil, apperr.Conflict("plan can only be sent while consultation is in progress")
	}
	switch v.Status {
	case domain.VerDraft, domain.VerInReview:
		// ok
	default:
		return nil, apperr.Conflict("plan cannot be sent from current version status")
	}
	if err := validatePlanForSend(v.Plan); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	convID := in.ConversationID
	if convID == nil {
		convID = c.ConversationID
	}
	if err := s.store.ApplyHairConsultationTransition(ctx, store.ConsultTransition{
		EventID: ids.New(), ConsultID: c.ID, VersionID: v.ID,
		ConsultFrom: domain.ConsultInProgress, ConsultTo: domain.ConsultAwaitingClient,
		VersionFrom: v.Status, VersionTo: domain.VerSent,
		Actor: actor, Action: "plan_sent", Now: now, SentAt: &now, ConversationID: convID,
	}); err != nil {
		return s.mapTransitionErr(ctx, id, actor, err)
	}
	s.notify(ctx, c.ClientUserID, "hair_consultation", "План консультации готов",
		"Мастер отправил план окрашивания на согласование", "hair_consultation", c.ID)
	return s.loadConsultation(ctx, id, actor)
}

func (s *Service) ApproveHairConsultation(ctx context.Context, id, actor uuid.UUID) (*domain.HairConsultation, error) {
	c, err := s.requireParticipant(ctx, id, actor)
	if err != nil {
		return nil, err
	}
	if err := s.requireClient(c, actor); err != nil {
		return nil, err
	}
	if c.Status == domain.ConsultApproved {
		return s.loadConsultation(ctx, id, actor)
	}
	v, err := s.currentVersion(ctx, c)
	if err != nil {
		return nil, err
	}
	if c.Status != domain.ConsultAwaitingClient || v.Status != domain.VerSent {
		return nil, apperr.Conflict("plan cannot be approved from current status")
	}
	now := s.now().UTC()
	meta, _ := json.Marshal(map[string]any{
		"approved_by": actor.String(), "version_no": v.VersionNo, "version_id": v.ID.String(),
	})
	if err := s.store.ApplyHairConsultationTransition(ctx, store.ConsultTransition{
		EventID: ids.New(), ConsultID: c.ID, VersionID: v.ID,
		ConsultFrom: domain.ConsultAwaitingClient, ConsultTo: domain.ConsultApproved,
		VersionFrom: domain.VerSent, VersionTo: domain.VerApproved,
		Actor: actor, Action: "plan_approved", Now: now, ApprovedAt: &now, ImmutableAt: &now, Meta: meta,
	}); err != nil {
		return s.mapTransitionErr(ctx, id, actor, err)
	}
	s.notify(ctx, c.MasterUserID, "hair_consultation", "План утверждён",
		"Клиент утвердил план консультации", "hair_consultation", c.ID)
	return s.loadConsultation(ctx, id, actor)
}

type RequestChangesInput struct {
	Comment string
}

func (s *Service) RequestHairConsultationChanges(ctx context.Context, id, actor uuid.UUID, in RequestChangesInput) (*domain.HairConsultation, error) {
	c, err := s.requireParticipant(ctx, id, actor)
	if err != nil {
		return nil, err
	}
	if err := s.requireClient(c, actor); err != nil {
		return nil, err
	}
	comment := strings.TrimSpace(in.Comment)
	if comment == "" {
		return nil, apperr.Validation("comment is required")
	}
	v, err := s.currentVersion(ctx, c)
	if err != nil {
		return nil, err
	}
	if c.Status != domain.ConsultAwaitingClient || v.Status != domain.VerSent {
		// Idempotent if already in progress with a newer draft after return.
		if c.Status == domain.ConsultInProgress && v.Status == domain.VerDraft && v.VersionNo > 1 {
			return s.loadConsultation(ctx, id, actor)
		}
		return nil, apperr.Conflict("changes can only be requested on a sent plan")
	}
	now := s.now().UTC()
	nextNo, err := s.store.NextHairConsultationVersionNo(ctx, c.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	newVID := ids.New()
	nv := domain.HairConsultationVersion{
		ID: newVID, ConsultationID: c.ID, VersionNo: nextNo, Status: domain.VerDraft,
		ClientQuestionnaire: v.ClientQuestionnaire,
		MasterAssessment:    v.MasterAssessment,
		Plan:                v.Plan,
		CreatedBy:           actor, CreatedAt: now, UpdatedAt: now,
	}
	meta, _ := json.Marshal(map[string]any{"comment": comment, "from_version_no": v.VersionNo})
	commentCopy := comment
	if err := s.store.ApplyHairConsultationTransition(ctx, store.ConsultTransition{
		EventID: ids.New(), ConsultID: c.ID, VersionID: v.ID,
		ConsultFrom: domain.ConsultAwaitingClient, ConsultTo: domain.ConsultInProgress,
		VersionFrom: domain.VerSent, VersionTo: domain.VerChangesRequested,
		Actor: actor, Action: "changes_requested", Now: now,
		ClientComment: &commentCopy, Meta: meta, NewVersion: &nv,
	}); err != nil {
		return s.mapTransitionErr(ctx, id, actor, err)
	}
	_ = s.store.InsertHairConsultationEvent(ctx, domain.HairConsultationEvent{
		ID: ids.New(), ConsultationID: c.ID, VersionID: &newVID, ActorUserID: actor,
		Action: "version_created", ToStatus: domain.ConsultInProgress,
		Meta: mustJSON(map[string]any{"version_no": nextNo, "reason": "changes_requested"}), CreatedAt: now,
	})
	s.notify(ctx, c.MasterUserID, "hair_consultation", "Клиент запросил правки",
		comment, "hair_consultation", c.ID)
	return s.loadConsultation(ctx, id, actor)
}

func (s *Service) CreateHairConsultationRevision(ctx context.Context, id, actor uuid.UUID) (*domain.HairConsultation, error) {
	c, err := s.requireParticipant(ctx, id, actor)
	if err != nil {
		return nil, err
	}
	if err := s.requireMaster(c, actor); err != nil {
		return nil, err
	}
	v, err := s.currentVersion(ctx, c)
	if err != nil {
		return nil, err
	}
	if c.Status != domain.ConsultApproved || v.Status != domain.VerApproved {
		return nil, apperr.Conflict("new version can only be created from an approved consultation")
	}
	now := s.now().UTC()
	nextNo, err := s.store.NextHairConsultationVersionNo(ctx, c.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	newVID := ids.New()
	nv := domain.HairConsultationVersion{
		ID: newVID, ConsultationID: c.ID, VersionNo: nextNo, Status: domain.VerDraft,
		ClientQuestionnaire: v.ClientQuestionnaire,
		MasterAssessment:    json.RawMessage(`{}`),
		Plan:                json.RawMessage(`{}`),
		CreatedBy:           actor, CreatedAt: now, UpdatedAt: now,
	}
	sid := v.ID
	if err := s.store.ApplyHairConsultationTransition(ctx, store.ConsultTransition{
		EventID: ids.New(), ConsultID: c.ID, VersionID: v.ID,
		ConsultFrom: domain.ConsultApproved, ConsultTo: domain.ConsultInProgress,
		VersionFrom: domain.VerApproved, VersionTo: domain.VerSuperseded,
		Actor: actor, Action: "revision_started", Now: now,
		SupersedeVersionID: &sid, NewVersion: &nv,
		Meta: mustJSON(map[string]any{"version_no": nextNo}),
	}); err != nil {
		return s.mapTransitionErr(ctx, id, actor, err)
	}
	return s.loadConsultation(ctx, id, actor)
}

type AttachMediaInput struct {
	MediaID uuid.UUID
	Slot    string
}

func (s *Service) AttachHairConsultationMedia(ctx context.Context, id, actor uuid.UUID, in AttachMediaInput) (*domain.HairConsultation, error) {
	c, err := s.requireParticipant(ctx, id, actor)
	if err != nil {
		return nil, err
	}
	if !domain.ValidMediaSlot(in.Slot) {
		return nil, apperr.Validation("invalid media slot")
	}
	if in.MediaID == uuid.Nil {
		return nil, apperr.Validation("media_id is required")
	}
	v, err := s.currentVersion(ctx, c)
	if err != nil {
		return nil, err
	}
	if domain.VersionImmutable(v) {
		return nil, apperr.Conflict("cannot modify media on immutable version")
	}
	isClient := c.ClientUserID == actor
	isMaster := c.MasterUserID == actor
	if isClient {
		if v.Status != domain.VerDraft || c.Status != domain.ConsultDraft {
			return nil, apperr.Conflict("client can attach photos only while drafting the questionnaire")
		}
		switch in.Slot {
		case domain.SlotOverview, domain.SlotRoots, domain.SlotLength, domain.SlotEnds, domain.SlotStrandA4, domain.SlotReference:
		default:
			return nil, apperr.Validation("invalid media slot")
		}
	} else if isMaster {
		return nil, apperr.Forbidden("master cannot attach client questionnaire photos")
	} else {
		return nil, apperr.Forbidden("access denied")
	}
	now := s.now().UTC()
	m := domain.HairConsultationMedia{
		ID: ids.New(), VersionID: v.ID, MediaID: in.MediaID, Slot: in.Slot, UploadedBy: actor, CreatedAt: now,
	}
	if err := s.store.AttachHairConsultationMedia(ctx, m, true); err != nil {
		if store.IsConsultImmutable(err) {
			return nil, apperr.Conflict("cannot modify media on immutable version")
		}
		return nil, apperr.Internal(err)
	}
	_ = s.store.InsertHairConsultationEvent(ctx, domain.HairConsultationEvent{
		ID: ids.New(), ConsultationID: c.ID, VersionID: &v.ID, ActorUserID: actor,
		Action: "media_attached", ToStatus: c.Status,
		Meta: mustJSON(map[string]any{"media_id": in.MediaID.String(), "slot": in.Slot}), CreatedAt: now,
	})
	return s.loadConsultation(ctx, id, actor)
}

func (s *Service) DetachHairConsultationMedia(ctx context.Context, id, actor, mediaID uuid.UUID) (*domain.HairConsultation, error) {
	c, err := s.requireParticipant(ctx, id, actor)
	if err != nil {
		return nil, err
	}
	if err := s.requireClient(c, actor); err != nil {
		return nil, err
	}
	v, err := s.currentVersion(ctx, c)
	if err != nil {
		return nil, err
	}
	if domain.VersionImmutable(v) {
		return nil, apperr.Conflict("cannot modify media on immutable version")
	}
	if v.Status != domain.VerDraft || c.Status != domain.ConsultDraft {
		return nil, apperr.Conflict("photos can only be removed while drafting")
	}
	if err := s.store.DetachHairConsultationMedia(ctx, v.ID, mediaID); err != nil {
		if store.IsConsultImmutable(err) {
			return nil, apperr.Conflict("cannot modify media on immutable version")
		}
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperr.NotFound("media attachment not found")
		}
		return nil, apperr.Internal(err)
	}
	return s.loadConsultation(ctx, id, actor)
}

// MediaVisibleToUser is called by the media service (S2S) for purpose hair_consultation.
func (s *Service) MediaVisibleToUser(ctx context.Context, mediaID, userID uuid.UUID) (bool, error) {
	rows, err := s.store.ListHairConsultationMediaByMediaID(ctx, mediaID)
	if err != nil {
		return false, apperr.Internal(err)
	}
	if len(rows) == 0 {
		return false, nil
	}
	for _, m := range rows {
		c, err := s.store.GetHairConsultationByVersionID(ctx, m.VersionID)
		if err != nil {
			return false, apperr.Internal(err)
		}
		if c == nil {
			continue
		}
		if c.ClientUserID == userID || c.MasterUserID == userID {
			return true, nil
		}
	}
	return false, nil
}

func (s *Service) mapTransitionErr(ctx context.Context, id, actor uuid.UUID, err error) (*domain.HairConsultation, error) {
	if store.IsConsultConflict(err) {
		if _, loadErr := s.loadConsultation(ctx, id, actor); loadErr != nil {
			return nil, loadErr
		}
		return nil, apperr.Conflict("consultation state conflict")
	}
	if store.IsConsultImmutable(err) {
		return nil, apperr.Conflict("version is immutable")
	}
	return nil, apperr.Internal(err)
}

func (s *Service) notify(ctx context.Context, userID uuid.UUID, typ, title, body, entityType string, entityID uuid.UUID) {
	if s.communicationsURL == "" || s.internalToken == "" {
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"user_id": userID.String(), "type": typ, "title": title, "body": body,
		"entity_type": entityType, "entity_id": entityID.String(),
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.communicationsURL+"/v1/internal/notifications", strings.NewReader(string(payload)))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return
	}
	_ = resp.Body.Close()
}

func normalizeJSON(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || string(raw) == "null" {
		return json.RawMessage(`{}`)
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return json.RawMessage(`{}`)
	}
	out, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return out
}

func mustJSON(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func hasSlot(media []domain.HairConsultationMedia, slot string) bool {
	for _, m := range media {
		if m.Slot == slot {
			return true
		}
	}
	return false
}

func validateQuestionnaireForSubmit(raw json.RawMessage) error {
	var q map[string]any
	if err := json.Unmarshal(normalizeJSON(raw), &q); err != nil {
		return apperr.Validation("invalid questionnaire")
	}
	desired, _ := q["desired_result"].(string)
	if strings.TrimSpace(desired) == "" {
		return apperr.Validation("desired_result is required")
	}
	hairType, _ := q["hair_type"].(string) // natural | colored
	if strings.TrimSpace(hairType) == "" {
		return apperr.Validation("hair_type is required")
	}
	return nil
}

func validatePlanForSend(raw json.RawMessage) error {
	var p map[string]any
	if err := json.Unmarshal(normalizeJSON(raw), &p); err != nil {
		return apperr.Validation("invalid plan")
	}
	desired, _ := p["desired_result"].(string)
	if strings.TrimSpace(desired) == "" {
		return apperr.Validation("plan.desired_result is required")
	}
	technique, _ := p["technique"].(string)
	if strings.TrimSpace(technique) == "" {
		return apperr.Validation("plan.technique is required")
	}
	formula, _ := p["formula"].(string)
	if strings.TrimSpace(formula) == "" {
		return apperr.Validation("plan.formula is required")
	}
	return nil
}

// normalizePlanPrices recomputes price_total_minor from marketplace catalog prices for
// selected_service_ids so the client cannot spoof the diagnostic total.
func (s *Service) normalizePlanPrices(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
	plan := map[string]any{}
	if err := json.Unmarshal(normalizeJSON(raw), &plan); err != nil {
		return nil, apperr.Validation("invalid plan")
	}
	ids := parseServiceIDList(plan["selected_service_ids"])
	if len(ids) == 0 {
		plan["selected_service_ids"] = []string{}
		plan["price_total_minor"] = int64(0)
		out, err := json.Marshal(plan)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		return out, nil
	}
	var total int64
	normalized := make([]string, 0, len(ids))
	for _, id := range ids {
		price, err := s.lookupServicePriceMinor(ctx, id)
		if err != nil {
			return nil, err
		}
		total += price
		normalized = append(normalized, id.String())
	}
	plan["selected_service_ids"] = normalized
	plan["price_total_minor"] = total
	out, err := json.Marshal(plan)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return out, nil
}

func parseServiceIDList(raw any) []uuid.UUID {
	arr, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]uuid.UUID, 0, len(arr))
	seen := map[uuid.UUID]struct{}{}
	for _, item := range arr {
		s, ok := item.(string)
		if !ok {
			continue
		}
		id, err := uuid.Parse(strings.TrimSpace(s))
		if err != nil {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func (s *Service) lookupServicePriceMinor(ctx context.Context, serviceID uuid.UUID) (int64, error) {
	if s.marketplaceURL == "" {
		return 0, apperr.Internal(errors.New("marketplace unavailable"))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.marketplaceURL+"/v1/services/"+serviceID.String(), nil)
	if err != nil {
		return 0, apperr.Internal(err)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return 0, apperr.Internal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return 0, apperr.Validation("unknown service in selected_service_ids")
	}
	if resp.StatusCode >= 300 {
		return 0, apperr.Internal(errors.New("marketplace unavailable"))
	}
	var body struct {
		PriceMinor int64 `json:"price_minor"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return 0, apperr.Internal(err)
	}
	if body.PriceMinor < 0 {
		return 0, apperr.Validation("invalid service price")
	}
	return body.PriceMinor, nil
}

func (s *Service) lookupMasterOrganization(ctx context.Context, masterUserID uuid.UUID) (*uuid.UUID, error) {
	if s.marketplaceURL == "" || s.internalToken == "" {
		return nil, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.marketplaceURL+"/v1/internal/masters/by-user/"+masterUserID.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, nil
	}
	var body struct {
		OrganizationID string `json:"organization_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	if strings.TrimSpace(body.OrganizationID) == "" {
		return nil, nil
	}
	id, err := uuid.Parse(body.OrganizationID)
	if err != nil {
		return nil, nil
	}
	return &id, nil
}
