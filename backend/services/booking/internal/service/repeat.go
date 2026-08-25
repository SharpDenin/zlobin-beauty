package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/entitlement"
)

type RepeatRequirement struct {
	ProductID    uuid.UUID
	ProductName  string
	Brand        string
	Unit         string
	RequiredQty  float64
	AvailableQty float64
	IncomingQty  float64
	ShortageQty  float64
	Status       string
	ExpectedAt   *string
}

type RepeatPreview struct {
	CanRepeat           bool
	AvailabilityStatus  string
	SourceAppointmentID uuid.UUID
	ServiceID           uuid.UUID
	ServiceName         string
	StartsAt            string
	FormulaHidden       bool
	SchemeHidden        bool
	HiddenReason        string
	Technique           string
	Notes               string
	Components          []RepeatComponent
	Requirements        []RepeatRequirement
}

type RepeatComponent struct {
	Name  string
	Brand string
	Qty   string
	Unit  string
}

func (s *Service) RepeatOptions(ctx context.Context, actor, clientUserID, preferredService uuid.UUID) (*RepeatPreview, error) {
	if clientUserID == uuid.Nil {
		return nil, apperr.Validation("client_id is required")
	}
	if actor == clientUserID {
		return nil, apperr.Forbidden("client cannot access master repeat options")
	}
	a, err := s.pickRepeatSource(ctx, actor, clientUserID, preferredService)
	if err != nil {
		return nil, err
	}
	if a == nil {
		return nil, nil
	}
	return s.RepeatPreview(ctx, actor, a.ID)
}

func (s *Service) pickRepeatSource(ctx context.Context, masterID, clientID, preferredService uuid.UUID) (*domain.Appointment, error) {
	items, err := s.store.ListCompletedForMasterClient(ctx, masterID, clientID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if len(items) == 0 {
		return nil, nil
	}
	ids := make([]uuid.UUID, 0, len(items))
	byID := map[uuid.UUID]domain.Appointment{}
	for _, it := range items {
		ids = append(ids, it.ID)
		byID[it.ID] = it
	}
	flags, err := s.store.SchemeFlagsByAppointmentIDs(ctx, ids)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	cands := make([]domain.RepeatCandidate, 0, len(items))
	for _, it := range items {
		f := flags[it.ID]
		cands = append(cands, domain.RepeatCandidate{
			ID: it.ID, ServiceID: it.ServiceID, StartsAt: it.StartsAt, UpdatedAt: it.UpdatedAt,
			HasScheme: f.Exists, Skipped: f.Skipped,
		})
	}
	sel := domain.SelectRepeatSource(cands, preferredService)
	if sel == nil {
		return nil, nil
	}
	a := byID[sel.ID]
	return &a, nil
}

func (s *Service) RepeatPreview(ctx context.Context, actor, appointmentID uuid.UUID) (*RepeatPreview, error) {
	a, err := s.store.GetAppointment(ctx, appointmentID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, apperr.NotFound("appointment not found")
	}
	if a.Status != domain.StatusCompleted {
		return nil, apperr.Validation("source appointment is not completed")
	}
	if a.MasterUserID != actor {
		return nil, apperr.Forbidden("repeat preview is limited to the assigned master")
	}
	scheme, err := s.store.GetServiceScheme(ctx, appointmentID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	snap, _ := s.entitlementSnapshot(ctx, actor)
	skipped, omit := false, false
	if scheme != nil {
		skipped, omit = scheme.Skipped, scheme.OmitFormula
	}
	vis := entitlement.VisitTechnicalView(true, false, skipped, omit, snap.IsPremium())
	out := &RepeatPreview{
		SourceAppointmentID: a.ID,
		ServiceID:           a.ServiceID,
		ServiceName:         a.ServiceName,
		StartsAt:            a.StartsAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		FormulaHidden:       !vis.RevealFormula,
		SchemeHidden:        !vis.RevealScheme,
		Requirements:        []RepeatRequirement{},
		Components:          []RepeatComponent{},
	}
	if !vis.RevealScheme || !vis.RevealFormula {
		out.HiddenReason = "Формула скрыта по настройкам доступа"
	}
	if vis.RevealScheme && scheme != nil && !scheme.Skipped {
		out.Technique = scheme.Technique
		out.Notes = scheme.Notes
	}
	reqs, err := s.fetchRepeatAvailability(ctx, a.MasterUserID, a.OrganizationID, a.ServiceID, a.ID)
	if err != nil {
		return nil, err
	}
	statuses := make([]string, 0, len(reqs))
	for _, r := range reqs {
		out.Requirements = append(out.Requirements, r)
		statuses = append(statuses, r.Status)
	}
	out.CanRepeat = canRepeatStatuses(statuses)
	out.AvailabilityStatus = worstAvailability(statuses)
	if vis.RevealFormula && scheme != nil {
		for _, c := range scheme.Components {
			if strings.TrimSpace(c.Name) == "" && strings.TrimSpace(c.Brand) == "" {
				continue
			}
			out.Components = append(out.Components, RepeatComponent{
				Name: c.Name, Brand: c.Brand, Qty: c.Qty, Unit: c.Unit,
			})
		}
	}
	return out, nil
}

func canRepeatStatuses(statuses []string) bool {
	if len(statuses) == 0 {
		return true
	}
	for _, st := range statuses {
		if st != "available" {
			return false
		}
	}
	return true
}

func worstAvailability(statuses []string) string {
	rank := map[string]int{"available": 0, "incoming": 1, "shortage": 2, "unavailable": 3}
	worst := "available"
	best := 0
	if len(statuses) == 0 {
		return worst
	}
	for _, st := range statuses {
		if rank[st] > best {
			best = rank[st]
			worst = st
		}
	}
	return worst
}

func (s *Service) fetchRepeatAvailability(ctx context.Context, owner, orgID, serviceID, appointmentID uuid.UUID) ([]RepeatRequirement, error) {
	if s.commerceURL == "" || s.internalToken == "" {
		return []RepeatRequirement{}, nil
	}
	payload, _ := json.Marshal(map[string]any{
		"owner_user_id":         owner.String(),
		"organization_id":       orgID.String(),
		"service_id":            serviceID.String(),
		"source_appointment_id": appointmentID.String(),
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.commerceURL+"/v1/internal/inventory/repeat-availability", bytes.NewReader(payload))
	if err != nil {
		return nil, apperr.Internal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, apperr.Internal(fmt.Errorf("commerce availability: %w", err))
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return nil, apperr.Internal(fmt.Errorf("commerce availability status %d: %s", resp.StatusCode, string(body)))
	}
	var parsed struct {
		Items []struct {
			ProductID    string  `json:"product_id"`
			ProductName  string  `json:"product_name"`
			Brand        string  `json:"brand"`
			Unit         string  `json:"unit"`
			RequiredQty  float64 `json:"required_qty"`
			AvailableQty float64 `json:"available_qty"`
			IncomingQty  float64 `json:"incoming_qty"`
			ShortageQty  float64 `json:"shortage_qty"`
			Status       string  `json:"status"`
			ExpectedAt   *string `json:"expected_at"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, apperr.Internal(err)
	}
	out := make([]RepeatRequirement, 0, len(parsed.Items))
	for _, it := range parsed.Items {
		pid, err := uuid.Parse(it.ProductID)
		if err != nil {
			continue
		}
		out = append(out, RepeatRequirement{
			ProductID: pid, ProductName: it.ProductName, Brand: it.Brand, Unit: it.Unit,
			RequiredQty: it.RequiredQty, AvailableQty: it.AvailableQty, IncomingQty: it.IncomingQty,
			ShortageQty: it.ShortageQty, Status: it.Status, ExpectedAt: it.ExpectedAt,
		})
	}
	return out, nil
}
