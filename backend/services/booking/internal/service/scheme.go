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
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/entitlement"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type VisitSchemeInput struct {
	Technique      string
	Notes          string
	CategoryFields json.RawMessage
	Skipped        bool
	Components     []store.SchemeComponent
}

func (s *Service) WithIdentity(identityURL string) *Service {
	s.identityURL = strings.TrimRight(identityURL, "/")
	return s
}

func (s *Service) entitlementSnapshot(ctx context.Context, userID uuid.UUID) (entitlement.Snapshot, error) {
	if s.identityURL == "" || s.internalToken == "" {
		return entitlement.Snapshot{EffectivePlan: entitlement.PlanFree}, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.identityURL+"/v1/internal/entitlements/"+userID.String(), nil)
	if err != nil {
		return entitlement.Snapshot{}, err
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return entitlement.Snapshot{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode >= 300 {
		return entitlement.Snapshot{}, fmt.Errorf("identity entitlements status %d: %s", resp.StatusCode, string(body))
	}
	var snap entitlement.Snapshot
	if err := json.Unmarshal(body, &snap); err != nil {
		return entitlement.Snapshot{}, err
	}
	return snap, nil
}

func (s *Service) canSkipScheme(ctx context.Context, userID uuid.UUID) bool {
	snap, err := s.entitlementSnapshot(ctx, userID)
	if err != nil {
		return false
	}
	return entitlement.CanSkipServiceScheme(snap)
}

func (s *Service) GetSchemeTemplateForAppointment(ctx context.Context, appointmentID, actor uuid.UUID) (*domain.SchemeTemplate, error) {
	a, err := s.Get(ctx, appointmentID, actor)
	if err != nil {
		return nil, err
	}
	category := domain.ResolveSchemeCategory(a.ServiceName)
	tmpl, err := s.store.GetActiveSchemeTemplate(ctx, category)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if tmpl == nil {
		tmpl, err = s.store.GetActiveSchemeTemplate(ctx, domain.SchemeCategoryGeneric)
		if err != nil {
			return nil, apperr.Internal(err)
		}
	}
	return tmpl, nil
}

func parseCategoryFields(raw json.RawMessage) map[string]string {
	out := map[string]string{}
	if len(raw) == 0 {
		return out
	}
	var anyMap map[string]any
	if err := json.Unmarshal(raw, &anyMap); err != nil {
		return out
	}
	for k, v := range anyMap {
		out[k] = strings.TrimSpace(fmt.Sprint(v))
	}
	return out
}

func validateSchemeAgainstTemplate(tmpl *domain.SchemeTemplate, scheme *VisitSchemeInput) error {
	if scheme.Skipped {
		return nil
	}
	if tmpl == nil {
		tech := strings.TrimSpace(scheme.Technique)
		hasComp := false
		for _, c := range scheme.Components {
			if strings.TrimSpace(c.Name) != "" {
				hasComp = true
				break
			}
		}
		if tech == "" && !hasComp {
			return apperr.Validation("fill technique or at least one product/material")
		}
		return nil
	}
	fields := parseCategoryFields(scheme.CategoryFields)
	for _, f := range tmpl.Fields {
		if !f.Required {
			continue
		}
		val := strings.TrimSpace(fields[f.Key])
		if f.Key == "technique" && val == "" {
			val = strings.TrimSpace(scheme.Technique)
		}
		if val == "" {
			return apperr.Validation("field required: " + f.Label)
		}
	}
	hasProduct := false
	for _, c := range scheme.Components {
		if strings.TrimSpace(c.Name) != "" {
			hasProduct = true
			break
		}
	}
	if categoryNeedsProduct(tmpl.CategoryKey) && !hasProduct && strings.TrimSpace(fields["product"]) == "" && strings.TrimSpace(fields["dye"]) == "" {
		return apperr.Validation("add at least one product or material")
	}
	return nil
}

func categoryNeedsProduct(category string) bool {
	switch category {
	case domain.SchemeCategoryColoring, domain.SchemeCategoryCare:
		return true
	default:
		return false
	}
}

func (s *Service) CompleteVisit(ctx context.Context, appointmentID, actorUserID uuid.UUID, scheme *VisitSchemeInput) (*domain.Appointment, error) {
	if scheme == nil {
		scheme = &VisitSchemeInput{}
	}
	if scheme.Skipped {
		if !s.canSkipScheme(ctx, actorUserID) {
			return nil, apperr.Forbidden("service scheme is required on the current plan")
		}
	}

	a, err := s.store.GetAppointment(ctx, appointmentID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("appointment not found")
	}
	if a.MasterUserID != actorUserID {
		return nil, apperr.Forbidden("only assigned master can complete")
	}
	if err := domain.Transition(a.Status, domain.StatusCompleted); err != nil {
		return nil, err
	}

	category := domain.ResolveSchemeCategory(a.ServiceName)
	tmpl, err := s.store.GetActiveSchemeTemplate(ctx, category)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if tmpl == nil {
		tmpl, _ = s.store.GetActiveSchemeTemplate(ctx, domain.SchemeCategoryGeneric)
	}
	if err := validateSchemeAgainstTemplate(tmpl, scheme); err != nil {
		return nil, err
	}

	now := s.now().UTC()
	fromStatus := a.Status
	comps := make([]store.SchemeComponent, 0, len(scheme.Components))
	for _, c := range scheme.Components {
		if strings.TrimSpace(c.Name) == "" {
			continue
		}
		comps = append(comps, c)
	}
	stored := store.ServiceScheme{
		AppointmentID: a.ID, Technique: strings.TrimSpace(scheme.Technique), Notes: strings.TrimSpace(scheme.Notes),
		CategoryFields: scheme.CategoryFields, Skipped: scheme.Skipped, CreatedBy: actorUserID, Components: comps,
	}
	if tmpl != nil {
		id, parseErr := uuid.Parse(tmpl.ID)
		if parseErr == nil {
			stored.TemplateID = &id
			stored.TemplateVersion = tmpl.Version
		}
	}
	auditMeta := fmt.Sprintf(`{"skipped":%v,"entitlement":"skip_service_scheme"}`, scheme.Skipped)
	if err := s.store.CompleteWithScheme(ctx, appointmentID, fromStatus, actorUserID, stored, auditMeta, now); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}

	a.Status = domain.StatusCompleted
	a.UpdatedAt = now
	s.notifyStatus(ctx, a, domain.StatusCompleted)
	s.notifyVisitCompleted(ctx, a)
	s.createVisitRecord(ctx, a)
	s.consumeStockForAppointment(ctx, a, actorUserID)
	return a, nil
}

func (s *Service) GetVisitScheme(ctx context.Context, appointmentID, actor uuid.UUID) (*store.ServiceScheme, error) {
	if _, err := s.Get(ctx, appointmentID, actor); err != nil {
		return nil, err
	}
	item, err := s.store.GetServiceScheme(ctx, appointmentID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return item, nil
}

func (s *Service) CreatePlannerBlock(ctx context.Context, actor uuid.UUID, title, category, timezone, color string, starts, ends time.Time, orgID *uuid.UUID, ownerUserID *uuid.UUID) (*store.PlannerBlock, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return nil, apperr.Validation("title is required")
	}
	if !ends.After(starts) {
		return nil, apperr.Validation("ends_at must be after starts_at")
	}
	if timezone == "" {
		timezone = "Europe/Moscow"
	}
	if _, err := time.LoadLocation(timezone); err != nil {
		return nil, apperr.Validation("invalid timezone")
	}
	owner := actor
	if ownerUserID != nil && *ownerUserID != uuid.Nil && *ownerUserID != actor {
		if orgID == nil {
			return nil, apperr.Validation("organization_id is required to create a block for staff")
		}
		if err := s.requireMembership(ctx, *orgID, actor, "owner", "admin"); err != nil {
			return nil, err
		}
		if err := s.requireMembership(ctx, *orgID, *ownerUserID, "owner", "admin", "master"); err != nil {
			return nil, err
		}
		owner = *ownerUserID
	}
	if err := s.validatePlannerInterval(ctx, owner, uuid.Nil, starts, ends, timezone); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	b := store.PlannerBlock{
		ID: ids.New(), OwnerUserID: owner, OrganizationID: orgID, Title: title,
		Category: strings.TrimSpace(category), StartsAt: starts.UTC(), EndsAt: ends.UTC(),
		Timezone: timezone, Color: colorOrDefault(color), CreatedAt: now, UpdatedAt: now,
	}
	if err := s.store.InsertPlannerBlock(ctx, b); err != nil {
		return nil, apperr.Internal(err)
	}
	return &b, nil
}

func (s *Service) ListPlannerBlocks(ctx context.Context, actor uuid.UUID, from, to time.Time, orgID *uuid.UUID) ([]store.PlannerBlock, error) {
	if to.Before(from) {
		return nil, apperr.Validation("invalid range")
	}
	var items []store.PlannerBlock
	var err error
	if orgID != nil {
		if err := s.requireMembership(ctx, *orgID, actor, "owner", "admin"); err != nil {
			return nil, err
		}
		items, err = s.store.ListPlannerBlocksForOrg(ctx, *orgID, actor, from, to)
	} else {
		items, err = s.store.ListPlannerBlocks(ctx, actor, from, to)
	}
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if items == nil {
		items = []store.PlannerBlock{}
	}
	return items, nil
}

func (s *Service) canEditPlannerBlock(ctx context.Context, actor uuid.UUID, b *store.PlannerBlock) error {
	if b.OwnerUserID == actor {
		return nil
	}
	if b.OrganizationID != nil {
		return s.requireMembership(ctx, *b.OrganizationID, actor, "owner", "admin")
	}
	return apperr.Forbidden("access denied")
}

func (s *Service) UpdatePlannerBlock(ctx context.Context, actor, id uuid.UUID, title, category, color string, starts, ends time.Time) (*store.PlannerBlock, error) {
	if !ends.After(starts) {
		return nil, apperr.Validation("ends_at must be after starts_at")
	}
	b, err := s.store.GetPlannerBlock(ctx, id)
	if err != nil {
		return nil, apperr.NotFound("block not found")
	}
	if err := s.canEditPlannerBlock(ctx, actor, b); err != nil {
		return nil, err
	}
	if strings.TrimSpace(title) != "" {
		b.Title = strings.TrimSpace(title)
	}
	if strings.TrimSpace(category) != "" {
		b.Category = strings.TrimSpace(category)
	}
	if strings.TrimSpace(color) != "" {
		b.Color = colorOrDefault(color)
	}
	if err := s.validatePlannerInterval(ctx, b.OwnerUserID, id, starts, ends, b.Timezone); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	b.StartsAt = starts.UTC()
	b.EndsAt = ends.UTC()
	b.UpdatedAt = now
	if err := s.store.UpdatePlannerBlock(ctx, *b); err != nil {
		return nil, apperr.Internal(err)
	}
	return b, nil
}

func (s *Service) MovePlannerBlock(ctx context.Context, actor, id uuid.UUID, starts, ends time.Time) (*store.PlannerBlock, error) {
	return s.UpdatePlannerBlock(ctx, actor, id, "", "", "", starts, ends)
}

func (s *Service) DeletePlannerBlock(ctx context.Context, actor, id uuid.UUID) error {
	b, err := s.store.GetPlannerBlock(ctx, id)
	if err != nil {
		return apperr.NotFound("block not found")
	}
	if err := s.canEditPlannerBlock(ctx, actor, b); err != nil {
		return err
	}
	if err := s.store.DeletePlannerBlock(ctx, id); err != nil {
		return apperr.Internal(err)
	}
	return nil
}

func colorOrDefault(c string) string {
	c = strings.TrimSpace(c)
	if c == "" {
		return "#b45a6a"
	}
	return c
}

func (s *Service) validatePlannerInterval(ctx context.Context, owner, excludeID uuid.UUID, starts, ends time.Time, timezone string) error {
	if !ends.After(starts) {
		return apperr.Validation("ends_at must be after starts_at")
	}
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		return apperr.Validation("invalid timezone")
	}
	localStart := starts.In(loc)
	localEnd := ends.In(loc)
	if localStart.YearDay() != localEnd.YearDay() || localStart.Year() != localEnd.Year() {
		return apperr.Validation("planner block must end on the same local day")
	}
	hours, err := s.store.ListWorkingHours(ctx, owner)
	if err != nil {
		return apperr.Internal(err)
	}
	if len(hours) > 0 {
		startMinute := localStart.Hour()*60 + localStart.Minute()
		endMinute := localEnd.Hour()*60 + localEnd.Minute()
		inside := false
		for _, h := range hours {
			if h.Weekday == int(localStart.Weekday()) && startMinute >= h.StartMinute && endMinute <= h.EndMinute {
				inside = true
				break
			}
		}
		if !inside {
			return apperr.Conflict("planner block is outside working hours")
		}
	}
	blocks, err := s.store.PlannerBlockOverlaps(ctx, owner, excludeID, starts.UTC(), ends.UTC())
	if err != nil {
		return apperr.Internal(err)
	}
	if blocks {
		return apperr.Conflict("planner block overlaps another event")
	}
	appointments, err := s.store.MasterAppointmentOverlaps(ctx, owner, uuid.Nil, starts.UTC(), ends.UTC())
	if err != nil {
		return apperr.Internal(err)
	}
	if appointments {
		return apperr.Conflict("planner block overlaps an appointment")
	}
	return nil
}
