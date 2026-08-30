package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type VisitPlanRequest struct {
	ServiceIDs []uuid.UUID
	Order      []uuid.UUID
	From       time.Time
	Limit      int
}

type VisitPlanResult struct {
	Timezone         string
	TotalPriceMinor  int64
	Currency         string
	RecommendedOrder []uuid.UUID
	ClientOrderValid bool
	OrderWarning     string
	OrderInvalidHint string
	Items            []VisitPlan
	HorizonDays      int
}

type ConfirmVisitPlanInput struct {
	ActorUserID    uuid.UUID
	ClientUserID   uuid.UUID
	Legs           []ConfirmLeg
	IdempotencyKey string
}

type ConfirmLeg struct {
	ServiceID uuid.UUID
	MasterID  uuid.UUID
	StartsAt  time.Time
}

const confirmVisitOp = "confirm_visit_plan"

func (s *Service) PlanVisit(ctx context.Context, actor uuid.UUID, in VisitPlanRequest) (*VisitPlanResult, error) {
	if actor == uuid.Nil {
		return nil, apperr.Unauthorized("login required")
	}
	if len(in.ServiceIDs) != 2 || in.ServiceIDs[0] == in.ServiceIDs[1] {
		return nil, apperr.Validation("exactly two different services are required")
	}
	limit := in.Limit
	if limit <= 0 {
		limit = DefaultPlanLimit
	}
	if limit > MaxPlanLimit {
		limit = MaxPlanLimit
	}

	svcs := make([]PlanService, 0, 2)
	for _, id := range in.ServiceIDs {
		ps, err := s.loadPlanService(ctx, id)
		if err != nil {
			return nil, err
		}
		svcs = append(svcs, *ps)
	}
	if svcs[0].OrganizationID != svcs[1].OrganizationID {
		return nil, apperr.ConflictCode(apperr.CodeServicesDifferentSalon, "services belong to different salons")
	}
	for i := range svcs {
		if svcs[i].BookingMode == domain.BookingModeFixedWindow {
			return nil, apperr.ConflictCode(apperr.CodeAppointmentNotReschedulable, "fixed_window services cannot join a multi-service visit")
		}
		if len(svcs[i].Masters) == 0 {
			return nil, apperr.ConflictCode(apperr.CodeBookingPlanUnavailable, "no compatible master for a selected service")
		}
	}

	kinds := []domain.ProcedureKind{
		domain.KindFromService(svcs[0].Category, svcs[0].Name),
		domain.KindFromService(svcs[1].Category, svcs[1].Name),
	}
	recIdx := domain.RecommendedOrder(kinds)
	recommended := []uuid.UUID{svcs[recIdx[0]].ID, svcs[recIdx[1]].ID}

	orderIDs := in.Order
	if len(orderIDs) == 0 {
		orderIDs = recommended
	}
	if len(orderIDs) != 2 {
		return nil, apperr.Validation("order must list both services")
	}
	ordered, err := arrangeServices(svcs, orderIDs)
	if err != nil {
		return nil, err
	}
	orderKinds := []domain.ProcedureKind{
		domain.KindFromService(ordered[0].Category, ordered[0].Name),
		domain.KindFromService(ordered[1].Category, ordered[1].Name),
	}
	out := &VisitPlanResult{
		RecommendedOrder: recommended,
		ClientOrderValid: true,
		HorizonDays:      PlanHorizonDays,
		Currency:         ordered[0].Currency,
		TotalPriceMinor:  ordered[0].PriceMinor + ordered[1].PriceMinor,
	}
	if err := domain.ValidateProcedureOrder(orderKinds); err != nil {
		hint := ""
		if ae, ok := apperr.As(err); ok {
			hint = ae.Message
			return nil, ae.WithDetails(map[string]any{
				"recommended_order": uuidListStrings(recommended),
				"hint":              hint,
			})
		}
		return nil, err
	}
	if recommended[0] != orderIDs[0] {
		out.OrderWarning = "Этот порядок возможен, но визит может занять больше времени."
	}

	tz := defaultTimezone
	if len(ordered[0].Masters) > 0 && ordered[0].Masters[0].BranchID != uuid.Nil {
		if loc := s.fetchBranchLocation(ctx, ordered[0].Masters[0].BranchID); loc != nil && loc.Timezone != "" {
			tz = loc.Timezone
		}
	}
	out.Timezone = tz
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
	}
	origin := in.From
	if origin.IsZero() {
		now := s.now().In(loc)
		origin = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	} else {
		local := origin.In(loc)
		origin = time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	}

	days := make([]time.Time, 0, PlanHorizonDays)
	perKey := map[slotKey][]Slot{}
	seenKey := map[slotKey]struct{}{}
	for i := 0; i < PlanHorizonDays; i++ {
		day := origin.AddDate(0, 0, i)
		days = append(days, day)
		for _, svc := range ordered {
			for _, m := range svc.Masters {
				k := slotKey{Master: m.MasterUserID, Day: slotDayKey(day), Dur: svc.DurationMinutes}
				if _, ok := seenKey[k]; ok {
					continue
				}
				seenKey[k] = struct{}{}
				slots, err := s.FreeSlots(ctx, m.MasterUserID, day, svc.DurationMinutes, tz, uuid.Nil)
				if err != nil {
					return nil, err
				}
				perKey[k] = slots
			}
		}
	}

	out.Items = AssembleVisitPlans(ordered, perKey, days, limit)
	if out.Items == nil {
		out.Items = []VisitPlan{}
	}
	return out, nil
}

func arrangeServices(svcs []PlanService, order []uuid.UUID) ([]PlanService, error) {
	byID := map[uuid.UUID]PlanService{}
	for _, s := range svcs {
		byID[s.ID] = s
	}
	out := make([]PlanService, 0, 2)
	for _, id := range order {
		s, ok := byID[id]
		if !ok {
			return nil, apperr.Validation("order references an unknown service")
		}
		out = append(out, s)
	}
	return out, nil
}

func (s *Service) loadPlanService(ctx context.Context, serviceID uuid.UUID) (*PlanService, error) {
	item, err := s.fetchMarketplaceService(ctx, serviceID)
	if err != nil {
		return nil, err
	}
	if !item.Published {
		return nil, apperr.NotFound("service not found")
	}
	masters, err := s.fetchServiceMasters(ctx, serviceID)
	if err != nil {
		return nil, err
	}
	cands := make([]PlanCandidate, 0, len(masters))
	for _, m := range masters {
		if !m.Published || m.OrganizationID != item.OrganizationID || m.BranchID == uuid.Nil {
			continue
		}
		cands = append(cands, m)
		if len(cands) >= MaxMastersPerService {
			break
		}
	}
	return &PlanService{
		ID: item.ID, Name: item.Name, Category: item.Category,
		DurationMinutes: item.DurationMinutes, PriceMinor: item.PriceMinor, Currency: item.Currency,
		OrganizationID: item.OrganizationID, BookingMode: item.BookingMode, Masters: cands,
	}, nil
}

type marketplaceService struct {
	ID              uuid.UUID
	OrganizationID  uuid.UUID
	Name            string
	Category        string
	DurationMinutes int
	PriceMinor      int64
	Currency        string
	BookingMode     string
	Published       bool
}

func (s *Service) fetchMarketplaceService(ctx context.Context, id uuid.UUID) (*marketplaceService, error) {
	if s.marketplaceURL == "" {
		return nil, apperr.Internal(fmt.Errorf("marketplace url not configured"))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.marketplaceURL+"/v1/services/"+id.String(), nil)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusNotFound {
		return nil, apperr.NotFound("service not found")
	}
	if resp.StatusCode >= 300 {
		return nil, apperr.Internal(fmt.Errorf("marketplace service status %d", resp.StatusCode))
	}
	var raw struct {
		ID              string `json:"id"`
		OrganizationID  string `json:"organization_id"`
		Name            string `json:"name"`
		Category        string `json:"category"`
		DurationMinutes int    `json:"duration_minutes"`
		PriceMinor      int64  `json:"price_minor"`
		Currency        string `json:"currency"`
		BookingMode     string `json:"booking_mode"`
		Published       bool   `json:"published"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, apperr.Internal(err)
	}
	sid, err := uuid.Parse(raw.ID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	oid, err := uuid.Parse(raw.OrganizationID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	mode := raw.BookingMode
	if mode == "" {
		mode = domain.BookingModeFlexible
	}
	cur := raw.Currency
	if cur == "" {
		cur = "RUB"
	}
	return &marketplaceService{
		ID: sid, OrganizationID: oid, Name: raw.Name, Category: raw.Category,
		DurationMinutes: raw.DurationMinutes, PriceMinor: raw.PriceMinor, Currency: cur,
		BookingMode: mode, Published: raw.Published,
	}, nil
}

func (s *Service) fetchServiceMasters(ctx context.Context, serviceID uuid.UUID) ([]PlanCandidate, error) {
	if s.marketplaceURL == "" {
		return nil, apperr.Internal(fmt.Errorf("marketplace url not configured"))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.marketplaceURL+"/v1/services/"+serviceID.String()+"/masters", nil)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return nil, apperr.Internal(fmt.Errorf("marketplace service masters status %d", resp.StatusCode))
	}
	var payload struct {
		Items []struct {
			ID             string  `json:"id"`
			UserID         string  `json:"user_id"`
			DisplayName    string  `json:"display_name"`
			OrganizationID string  `json:"organization_id"`
			BranchID       *string `json:"branch_id"`
			Published      bool    `json:"published"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, apperr.Internal(err)
	}
	out := make([]PlanCandidate, 0, len(payload.Items))
	for _, it := range payload.Items {
		mid, err := uuid.Parse(it.ID)
		if err != nil {
			continue
		}
		uid, err := uuid.Parse(it.UserID)
		if err != nil {
			continue
		}
		oid, err := uuid.Parse(it.OrganizationID)
		if err != nil {
			continue
		}
		var bid uuid.UUID
		if it.BranchID != nil && *it.BranchID != "" {
			bid, _ = uuid.Parse(*it.BranchID)
		}
		out = append(out, PlanCandidate{
			MasterID: mid, MasterUserID: uid, MasterDisplayName: it.DisplayName,
			OrganizationID: oid, BranchID: bid, Published: it.Published,
		})
	}
	return out, nil
}

func uuidListStrings(list []uuid.UUID) []string {
	out := make([]string, 0, len(list))
	for _, id := range list {
		out = append(out, id.String())
	}
	return out
}

func (s *Service) ConfirmVisitPlan(ctx context.Context, in ConfirmVisitPlanInput) ([]domain.Appointment, error) {
	if in.ActorUserID == uuid.Nil {
		return nil, apperr.Unauthorized("login required")
	}
	if in.ClientUserID != in.ActorUserID {
		return nil, apperr.Forbidden("only the client can confirm their visit plan")
	}
	idemKey := strings.TrimSpace(in.IdempotencyKey)
	if idemKey != "" {
		rec, err := s.store.GetIdempotency(ctx, idemKey, in.ClientUserID, confirmVisitOp)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if rec != nil && rec.EntityID != nil {
			existing, err := s.store.ListByVisitGroup(ctx, *rec.EntityID)
			if err != nil {
				return nil, apperr.Internal(err)
			}
			if len(existing) > 0 {
				return existing, nil
			}
		}
	}
	if len(in.Legs) != 2 {
		return nil, apperr.Validation("plan must contain two legs")
	}
	if in.Legs[0].ServiceID == in.Legs[1].ServiceID {
		return nil, apperr.Validation("legs must be different services")
	}

	svcs := make([]PlanService, 0, 2)
	for _, leg := range in.Legs {
		ps, err := s.loadPlanService(ctx, leg.ServiceID)
		if err != nil {
			return nil, err
		}
		svcs = append(svcs, *ps)
	}
	if svcs[0].OrganizationID != svcs[1].OrganizationID {
		return nil, apperr.ConflictCode(apperr.CodeServicesDifferentSalon, "services belong to different salons")
	}
	kinds := []domain.ProcedureKind{
		domain.KindFromService(svcs[0].Category, svcs[0].Name),
		domain.KindFromService(svcs[1].Category, svcs[1].Name),
	}
	if err := domain.ValidateProcedureOrder(kinds); err != nil {
		return nil, err
	}

	composed := make([]domain.Appointment, 0, 2)
	for i, leg := range in.Legs {
		a, err := s.composeFlexibleLeg(ctx, CreateInput{
			ClientUserID: in.ClientUserID,
			ActorUserID:  in.ActorUserID,
			MasterID:     leg.MasterID,
			ServiceID:    leg.ServiceID,
			StartsAt:     leg.StartsAt,
		}, &svcs[i])
		if err != nil {
			return nil, err
		}
		composed = append(composed, *a)
	}
	if composed[1].StartsAt.Before(composed[0].EndsAt) {
		return nil, apperr.ConflictCode(apperr.CodeAppointmentTimeConflict, "selected time is not available")
	}
	if int(composed[1].StartsAt.Sub(composed[0].EndsAt)/time.Minute) > MaxWaitMinutes {
		return nil, apperr.ConflictCode(apperr.CodeAppointmentTimeConflict, "selected time is not available")
	}
	if composed[0].MasterUserID == composed[1].MasterUserID &&
		IntervalsOverlap(composed[0].StartsAt, composed[0].EndsAt, composed[1].StartsAt, composed[1].EndsAt) {
		return nil, apperr.ConflictCode(apperr.CodeAppointmentTimeConflict, "selected time is not available")
	}

	groupID := ids.New()
	for i := range composed {
		id := groupID
		composed[i].VisitGroupID = &id
	}
	if err := s.store.CreateAppointments(ctx, composed); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	if idemKey != "" && composed[0].VisitGroupID != nil {
		_ = s.store.PutIdempotency(ctx, idemKey, in.ClientUserID, confirmVisitOp, *composed[0].VisitGroupID, http.StatusCreated)
	}
	for _, a := range composed {
		if a.Status == domain.StatusConfirmed {
			s.notify(ctx, a.MasterUserID, "appointment.created", "Новая запись", a.ServiceName+" (автоподтверждение)", a.ID)
			s.notify(ctx, a.ClientUserID, "appointment.created", "Запись подтверждена", a.ServiceName, a.ID)
		} else {
			s.notify(ctx, a.MasterUserID, "appointment.created", "Новая запись", a.ServiceName, a.ID)
			s.notify(ctx, a.ClientUserID, "appointment.created", "Запись создана", "Ожидает подтверждения мастера", a.ID)
		}
	}
	return composed, nil
}

func (s *Service) composeFlexibleLeg(ctx context.Context, in CreateInput, known *PlanService) (*domain.Appointment, error) {
	if in.StartsAt.Before(s.now().UTC()) {
		return nil, apperr.Validation("starts_at must be in the future")
	}
	payload, err := s.fetchMaster(ctx, in.MasterID)
	if err != nil {
		return nil, err
	}
	if !payload.Master.Published {
		return nil, apperr.NotFound("master not found")
	}
	masterUserID, err := uuid.Parse(payload.Master.UserID)
	if err != nil {
		return nil, apperr.Internal(fmt.Errorf("bad master user id"))
	}
	blocked, err := s.store.IsBlacklisted(ctx, masterUserID, in.ClientUserID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if blocked {
		return nil, apperr.ForbiddenCode(apperr.CodeClientBlacklisted, "client is blacklisted for this master")
	}
	orgID, err := uuid.Parse(payload.Master.OrganizationID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if known != nil && orgID != known.OrganizationID {
		return nil, apperr.Forbidden("master does not belong to the service salon")
	}
	if payload.Master.BranchID == nil {
		return nil, apperr.Validation("master has no branch")
	}
	branchID, err := uuid.Parse(*payload.Master.BranchID)
	if err != nil {
		return nil, apperr.Validation("invalid master branch")
	}
	var svcName string
	var duration int
	var price int64
	currency := "RUB"
	found := false
	for _, svc := range payload.Services {
		if svc.ID == in.ServiceID.String() {
			found = true
			svcName = svc.Name
			duration = svc.DurationMinutes
			price = svc.PriceMinor
			currency = svc.Currency
			break
		}
	}
	if !found {
		return nil, apperr.Validation("service is not offered by master")
	}
	startsAt := in.StartsAt.UTC()
	tz := s.timezoneForBranch(ctx, branchID)
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return nil, apperr.Validation("invalid timezone")
	}
	localStart := startsAt.In(loc)
	slots, err := s.FreeSlots(ctx, masterUserID, localStart, duration, tz, uuid.Nil)
	if err != nil {
		return nil, err
	}
	if !ContainsSlotStart(slots, startsAt) {
		return nil, apperr.ConflictCode(apperr.CodeAppointmentTimeConflict, "selected time is not available")
	}
	locSnap := s.fetchBranchLocation(ctx, branchID)
	locName, locCity, locAddr, locTZ := "", "", "", tz
	if locSnap != nil {
		locName, locCity, locAddr, locTZ = locSnap.Name, locSnap.City, locSnap.Address, locSnap.Timezone
	}
	now := s.now().UTC()
	status := domain.StatusPendingConfirmation
	auto, err := s.store.GetClientAutoConfirm(ctx, masterUserID, in.ClientUserID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if auto {
		status = domain.StatusConfirmed
	}
	a := domain.Appointment{
		ID: ids.New(), OrganizationID: orgID, BranchID: branchID, MasterUserID: masterUserID,
		ClientUserID: in.ClientUserID, ServiceID: in.ServiceID, ServiceName: svcName,
		DurationMinutes: duration, PriceMinor: price, Currency: currency,
		Status: status, StartsAt: startsAt, EndsAt: startsAt.Add(time.Duration(duration) * time.Minute),
		BookingMode:  domain.BookingModeFlexible,
		LocationName: locName, LocationCity: locCity, LocationAddress: locAddr, LocationTimezone: locTZ,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := s.attachWorkModeSnapshot(ctx, &a, in.DistrictID); err != nil {
		return nil, err
	}
	return &a, nil
}

func (s *Service) ListVisitGroup(ctx context.Context, appointmentID, actor uuid.UUID) ([]domain.Appointment, error) {
	a, err := s.Get(ctx, appointmentID, actor)
	if err != nil {
		return nil, err
	}
	if a.VisitGroupID == nil {
		return []domain.Appointment{*a}, nil
	}
	items, err := s.store.ListByVisitGroup(ctx, *a.VisitGroupID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []domain.Appointment{*a}
	}
	return items, nil
}
