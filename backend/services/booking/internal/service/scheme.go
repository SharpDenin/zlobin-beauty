package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/entitlement"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
	"github.com/zlobin/zlobin-beauty/backend/shared/moderation"
)

type VisitSchemeInput struct {
	Technique      string
	Notes          string
	CategoryFields json.RawMessage
	Skipped        bool
	OmitFormula    bool
	Components     []store.SchemeComponent
}

// VisitSchemeView is the disclosure-safe scheme payload for API responses.
type VisitSchemeView struct {
	AppointmentID   uuid.UUID
	Exists          bool
	Skipped         bool
	OmitFormula     bool
	DetailsRedacted bool
	FormulaRedacted bool
	Technique       string
	Notes           string
	CategoryFields  json.RawMessage
	Components      []store.SchemeComponent
	TemplateID      *uuid.UUID
	TemplateVersion int
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
	if scheme.OmitFormula {
		snap, err := s.entitlementSnapshot(ctx, actorUserID)
		if err != nil || !entitlement.CanOmitFormula(snap) {
			return nil, apperr.Forbidden("omit_formula requires an active paid plan")
		}
		if !hasFormulaContent(scheme) {
			return nil, apperr.Validation("omit_formula requires a color formula")
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
		CategoryFields: scheme.CategoryFields, Skipped: scheme.Skipped, OmitFormula: scheme.OmitFormula,
		CreatedBy: actorUserID, Components: comps,
	}
	if tmpl != nil {
		id, parseErr := uuid.Parse(tmpl.ID)
		if parseErr == nil {
			stored.TemplateID = &id
			stored.TemplateVersion = tmpl.Version
		}
	}
	auditMeta := fmt.Sprintf(`{"skipped":%v,"omit_formula":%v,"entitlement":"skip_service_scheme"}`, scheme.Skipped, scheme.OmitFormula)
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
	s.persistColorFormula(ctx, a, scheme)
	s.consumeStockForAppointment(ctx, a, actorUserID)
	return a, nil
}

func (s *Service) GetVisitScheme(ctx context.Context, appointmentID, actor uuid.UUID) (*VisitSchemeView, error) {
	a, err := s.authorizeSchemeViewer(ctx, appointmentID, actor)
	if err != nil {
		return nil, err
	}
	item, err := s.store.GetServiceScheme(ctx, appointmentID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	view := &VisitSchemeView{AppointmentID: appointmentID}
	if item == nil {
		return view, nil
	}
	isOwner := a.MasterUserID == actor
	isClient := a.ClientUserID == actor
	// Salon owner/admin previously received the full stored scheme via Get().
	// Keep that existing rule: they are not “other masters” under subscription redaction.
	if !isOwner && !isClient && s.isOrgOwnerOrAdmin(ctx, a.OrganizationID, actor) {
		isOwner = true
	}
	snap, _ := s.entitlementSnapshot(ctx, actor)
	vis := entitlement.VisitTechnicalView(isOwner, isClient, item.Skipped, item.OmitFormula, snap.IsPremium())
	view.Exists = true
	view.Skipped = item.Skipped
	view.OmitFormula = item.OmitFormula
	view.TemplateID = item.TemplateID
	view.TemplateVersion = item.TemplateVersion
	view.DetailsRedacted = !vis.RevealScheme
	view.FormulaRedacted = !vis.RevealFormula
	if vis.RevealScheme {
		view.Technique = item.Technique
		view.Notes = item.Notes
	}
	view.CategoryFields = projectCategoryFields(item.CategoryFields, vis.RevealScheme, vis.RevealFormula)
	if vis.RevealFormula {
		view.Components = item.Components
	}
	return view, nil
}

func (s *Service) authorizeSchemeViewer(ctx context.Context, appointmentID, actor uuid.UUID) (*domain.Appointment, error) {
	a, err := s.store.GetAppointment(ctx, appointmentID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("appointment not found")
	}
	if a.MasterUserID == actor || a.ClientUserID == actor || s.isOrgOwnerOrAdmin(ctx, a.OrganizationID, actor) {
		return a, nil
	}
	ok, err := s.store.MasterHasCompletedWithClient(ctx, actor, a.ClientUserID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if !ok {
		return nil, apperr.Forbidden("access denied")
	}
	return a, nil
}

func (s *Service) CreatePlannerBlock(ctx context.Context, actor uuid.UUID, title, category, timezone, color string, starts, ends time.Time, orgID *uuid.UUID, ownerUserID *uuid.UUID) (*store.PlannerBlock, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return nil, apperr.Validation("title is required")
	}
	if err := moderation.ValidateFields(map[string]string{"title": title}); err != nil {
		return nil, err
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
	category = strings.TrimSpace(category)
	normalizedColor, err := NormalizePlannerColor(color, category)
	if err != nil {
		return nil, err
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
		Category: category, StartsAt: starts.UTC(), EndsAt: ends.UTC(),
		Timezone: timezone, Color: normalizedColor, CreatedAt: now, UpdatedAt: now,
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
		title = strings.TrimSpace(title)
		if err := moderation.ValidateFields(map[string]string{"title": title}); err != nil {
			return nil, err
		}
		b.Title = title
	}
	if strings.TrimSpace(category) != "" {
		b.Category = strings.TrimSpace(category)
	}
	if strings.TrimSpace(color) != "" {
		normalized, nerr := NormalizePlannerColor(color, b.Category)
		if nerr != nil {
			return nil, nerr
		}
		b.Color = normalized
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
			return apperr.ConflictCode(apperr.CodePlannerOutsideHours, "planner block is outside working hours")
		}
	}
	blocks, err := s.store.PlannerBlockOverlaps(ctx, owner, excludeID, starts.UTC(), ends.UTC())
	if err != nil {
		return apperr.Internal(err)
	}
	if blocks {
		return apperr.ConflictCode(apperr.CodePlannerOverlap, "planner block overlaps another event")
	}
	appointments, err := s.store.MasterAppointmentOverlaps(ctx, owner, uuid.Nil, starts.UTC(), ends.UTC())
	if err != nil {
		return apperr.Internal(err)
	}
	if appointments {
		return apperr.ConflictCode(apperr.CodePlannerOverlap, "planner block overlaps an appointment")
	}
	return nil
}

func hasFormulaContent(scheme *VisitSchemeInput) bool {
	if scheme == nil {
		return false
	}
	for _, c := range scheme.Components {
		if strings.TrimSpace(c.Name) != "" {
			return true
		}
	}
	fields := parseCategoryFields(scheme.CategoryFields)
	for _, key := range entitlement.FormulaFieldKeys {
		if strings.TrimSpace(fields[key]) != "" {
			return true
		}
	}
	return false
}

func projectCategoryFields(raw json.RawMessage, revealScheme, revealFormula bool) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(`{}`)
	}
	if revealScheme && revealFormula {
		return raw
	}
	var fields map[string]any
	if err := json.Unmarshal(raw, &fields); err != nil {
		return json.RawMessage(`{}`)
	}
	out := make(map[string]any, len(fields))
	for k, v := range fields {
		formula := entitlement.IsFormulaFieldKey(k)
		if formula && revealFormula {
			out[k] = v
		}
		if !formula && revealScheme {
			out[k] = v
		}
	}
	b, err := json.Marshal(out)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return b
}

func (s *Service) persistColorFormula(ctx context.Context, a *domain.Appointment, scheme *VisitSchemeInput) {
	if scheme == nil || (!hasFormulaContent(scheme) && !scheme.OmitFormula) {
		return
	}
	if s.clientsURL == "" || s.internalToken == "" {
		slog.Warn("persist color formula skipped: clients URL or internal token missing", "appointment_id", a.ID)
		return
	}
	// CompleteVisit already authorized omit_formula. Do not second-guess here:
	// dropping the flag would leak the formula through the clients list endpoint.
	omit := scheme.OmitFormula
	fields := parseCategoryFields(scheme.CategoryFields)
	name := strings.TrimSpace(fields["formula"])
	if name == "" {
		name = strings.TrimSpace(fields["dye"])
	}
	if name == "" {
		name = "Состав окрашивания"
	}
	comps := make([]map[string]string, 0, len(scheme.Components)+2)
	for _, c := range scheme.Components {
		if strings.TrimSpace(c.Name) == "" {
			continue
		}
		comps = append(comps, map[string]string{"label": c.Name, "amount": strings.TrimSpace(c.Qty + " " + c.Proportion)})
	}
	if dye := strings.TrimSpace(fields["dye"]); dye != "" {
		comps = append(comps, map[string]string{"label": dye})
	}
	if shades := strings.TrimSpace(fields["shades"]); shades != "" {
		comps = append(comps, map[string]string{"label": shades})
	}
	compJSON, _ := json.Marshal(comps)
	var compsAny any
	_ = json.Unmarshal(compJSON, &compsAny)
	payload, _ := json.Marshal(map[string]any{
		"appointment_id": a.ID.String(),
		"master_user_id": a.MasterUserID.String(),
		"name":           name,
		"brand":          "",
		"components":     compsAny,
		"oxidizer":       strings.TrimSpace(fields["oxidizer"]),
		"ratio":          strings.TrimSpace(fields["proportions"]),
		"comment":        strings.TrimSpace(scheme.Notes),
		"omit_formula":   omit,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.clientsURL+"/v1/internal/formulas", strings.NewReader(string(payload)))
	if err != nil {
		slog.Warn("persist color formula request build failed", "appointment_id", a.ID, "error", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		slog.Warn("persist color formula request failed", "appointment_id", a.ID, "error", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
		slog.Warn("persist color formula rejected", "appointment_id", a.ID, "status", resp.StatusCode, "body", string(body))
	}
}
