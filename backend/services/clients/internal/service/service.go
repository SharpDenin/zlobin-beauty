package service

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type Service struct {
	store         *store.Store
	internalToken string
	now           func() time.Time
}

func New(st *store.Store, internalToken string) *Service {
	return &Service{store: st, internalToken: internalToken, now: time.Now}
}

func (s *Service) CheckInternal(token string) error {
	if s.internalToken == "" || token != s.internalToken {
		return apperr.Unauthorized("invalid internal token")
	}
	return nil
}

type FromAppointmentInput struct {
	AppointmentID  uuid.UUID
	OrganizationID uuid.UUID
	MasterUserID   uuid.UUID
	ClientUserID   uuid.UUID
	ServiceName    string
	PriceMinor     int64
	Currency       string
	StartedAt      time.Time
	CompletedAt    time.Time
	DisplayName    string
}

func (s *Service) FromAppointment(ctx context.Context, in FromAppointmentInput) (*domain.ClientCard, error) {
	if in.AppointmentID == uuid.Nil || in.OrganizationID == uuid.Nil || in.MasterUserID == uuid.Nil || in.ClientUserID == uuid.Nil {
		return nil, apperr.Validation("appointment_id, organization_id, master_user_id and client_user_id are required")
	}
	name := strings.TrimSpace(in.ServiceName)
	if name == "" {
		return nil, apperr.Validation("service_name is required")
	}
	currency := strings.TrimSpace(in.Currency)
	if currency == "" {
		currency = "RUB"
	}
	display := strings.TrimSpace(in.DisplayName)
	if display == "" {
		display = "Клиент"
	}
	if in.StartedAt.IsZero() || in.CompletedAt.IsZero() {
		return nil, apperr.Validation("started_at and completed_at are required")
	}
	now := s.now().UTC()
	card := domain.ClientCard{
		ID: ids.New(), OrganizationID: in.OrganizationID, UserID: in.ClientUserID,
		DisplayName: display, Preferences: "", CreatedAt: now, UpdatedAt: now,
	}
	visit := domain.Visit{
		ID: ids.New(), AppointmentID: in.AppointmentID, OrganizationID: in.OrganizationID,
		MasterUserID: in.MasterUserID, ServiceName: name, PriceMinor: in.PriceMinor, Currency: currency,
		StartedAt: in.StartedAt.UTC(), CompletedAt: in.CompletedAt.UTC(), CreatedAt: now,
	}
	outCard, _, _, err := s.store.UpsertCardAndVisit(ctx, card, visit)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return outCard, nil
}

func (s *Service) ensureAccess(ctx context.Context, card *domain.ClientCard, actor uuid.UUID) error {
	if card.UserID == actor {
		return nil
	}
	ok, err := s.store.MasterHasVisitOnCard(ctx, card.ID, actor)
	if err != nil {
		return apperr.Internal(err)
	}
	if !ok {
		return apperr.Forbidden("access denied")
	}
	return nil
}

func (s *Service) GetCard(ctx context.Context, id, actor uuid.UUID) (*domain.ClientCard, error) {
	card, err := s.store.GetCard(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if card == nil {
		return nil, apperr.NotFound("client not found")
	}
	if err := s.ensureAccess(ctx, card, actor); err != nil {
		return nil, err
	}
	return card, nil
}

// ListMine returns the client's own card(s) plus any cards the caller has
// served as a master, optionally filtered to a single organization and segment.
func (s *Service) ListMine(ctx context.Context, actor uuid.UUID, orgID *uuid.UUID, segment string) ([]domain.ClientCardListItem, error) {
	own, err := s.store.ListCardsForUser(ctx, actor)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	served, err := s.store.ListCardsForMaster(ctx, actor, orgID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	seen := make(map[uuid.UUID]struct{}, len(own)+len(served))
	cards := make([]domain.ClientCard, 0, len(own)+len(served))
	for _, c := range own {
		if orgID != nil && c.OrganizationID != *orgID {
			continue
		}
		if _, ok := seen[c.ID]; ok {
			continue
		}
		seen[c.ID] = struct{}{}
		cards = append(cards, c)
	}
	for _, c := range served {
		if _, ok := seen[c.ID]; ok {
			continue
		}
		seen[c.ID] = struct{}{}
		cards = append(cards, c)
	}
	ids := make([]uuid.UUID, 0, len(cards))
	for _, c := range cards {
		ids = append(ids, c.ID)
	}
	stats, err := s.store.VisitStatsForCards(ctx, ids)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	now := s.now().UTC()
	segment = strings.TrimSpace(strings.ToLower(segment))
	out := make([]domain.ClientCardListItem, 0, len(cards))
	for _, c := range cards {
		st := stats[c.ID]
		item := domain.ClientCardListItem{
			Card: c, VisitCount: st.VisitCount, FirstVisitAt: st.FirstVisitAt, LastVisitAt: st.LastVisitAt,
			Segment: classifySegment(st, now),
		}
		if segment != "" && item.Segment != segment {
			continue
		}
		out = append(out, item)
	}
	return out, nil
}

func classifySegment(st store.VisitStats, now time.Time) string {
	if st.VisitCount == 0 || st.LastVisitAt == nil {
		return "unknown"
	}
	if st.FirstVisitAt != nil && now.Sub(*st.FirstVisitAt) <= 30*24*time.Hour {
		return "new"
	}
	if now.Sub(*st.LastVisitAt) <= 90*24*time.Hour {
		return "active"
	}
	return "lapsed"
}

func (s *Service) ByAppointment(ctx context.Context, appointmentID, actor uuid.UUID) (*domain.ClientCard, error) {
	visit, err := s.store.GetVisitByAppointment(ctx, appointmentID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if visit == nil {
		return nil, apperr.NotFound("client card not found for appointment")
	}
	card, err := s.store.GetCard(ctx, visit.ClientCardID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if card == nil {
		return nil, apperr.NotFound("client card not found for appointment")
	}
	if card.UserID != actor && visit.MasterUserID != actor {
		return nil, apperr.Forbidden("access denied")
	}
	return card, nil
}

func (s *Service) ListVisits(ctx context.Context, cardID, actor uuid.UUID) ([]domain.Visit, error) {
	if _, err := s.GetCard(ctx, cardID, actor); err != nil {
		return nil, err
	}
	items, err := s.store.ListVisits(ctx, cardID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.Visit{}
	}
	return items, nil
}

func (s *Service) AddNote(ctx context.Context, cardID, actor, visitID uuid.UUID, body string) error {
	body = strings.TrimSpace(body)
	if body == "" {
		return apperr.Validation("body is required")
	}
	if _, err := s.GetCard(ctx, cardID, actor); err != nil {
		return err
	}
	visit, err := s.store.GetVisit(ctx, visitID)
	if err != nil {
		return apperr.Internal(err)
	}
	if visit == nil || visit.ClientCardID != cardID {
		return apperr.NotFound("visit not found")
	}
	if visit.MasterUserID != actor {
		return apperr.Forbidden("only visit master can add notes")
	}
	return wrap(s.store.CreateNote(ctx, domain.VisitNote{
		ID: ids.New(), VisitID: visitID, AuthorUserID: actor, Body: body, CreatedAt: s.now().UTC(),
	}))
}

func (s *Service) AddFormula(ctx context.Context, cardID, actor uuid.UUID, name, brand string, components json.RawMessage, oxidizer, ratio, comment string, visitID *uuid.UUID) (*domain.ColorFormula, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, apperr.Validation("name is required")
	}
	if _, err := s.GetCard(ctx, cardID, actor); err != nil {
		return nil, err
	}
	if visitID != nil {
		visit, err := s.store.GetVisit(ctx, *visitID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if visit == nil || visit.ClientCardID != cardID {
			return nil, apperr.Validation("visit_id does not belong to this card")
		}
	}
	if len(components) == 0 {
		components = json.RawMessage("[]")
	} else if !json.Valid(components) {
		return nil, apperr.Validation("components must be valid json")
	}
	f := domain.ColorFormula{
		ID: ids.New(), ClientCardID: cardID, VisitID: visitID, Name: name, Brand: strings.TrimSpace(brand),
		Components: components, Oxidizer: strings.TrimSpace(oxidizer), Ratio: strings.TrimSpace(ratio),
		Comment: strings.TrimSpace(comment), CreatedBy: actor, CreatedAt: s.now().UTC(),
	}
	if err := s.store.CreateFormula(ctx, f); err != nil {
		return nil, apperr.Internal(err)
	}
	return &f, nil
}

func (s *Service) ListFormulas(ctx context.Context, cardID, actor uuid.UUID) ([]domain.ColorFormula, error) {
	if _, err := s.GetCard(ctx, cardID, actor); err != nil {
		return nil, err
	}
	items, err := s.store.ListFormulas(ctx, cardID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.ColorFormula{}
	}
	return items, nil
}

func (s *Service) SetConsent(ctx context.Context, cardID, actor uuid.UUID, consentType string, granted bool) error {
	card, err := s.store.GetCard(ctx, cardID)
	if err != nil {
		return apperr.Internal(err)
	}
	if card == nil {
		return apperr.NotFound("client not found")
	}
	if card.UserID != actor {
		return apperr.Forbidden("only client can update consents")
	}
	consentType = strings.TrimSpace(consentType)
	if consentType == "" {
		return apperr.Validation("consent_type is required")
	}
	_, err = s.store.UpsertConsent(ctx, domain.Consent{
		ID: ids.New(), ClientCardID: cardID, ConsentType: consentType, Granted: granted, CreatedAt: s.now().UTC(),
	})
	return wrap(err)
}

func wrap(err error) error {
	if err != nil {
		return apperr.Internal(err)
	}
	return nil
}
