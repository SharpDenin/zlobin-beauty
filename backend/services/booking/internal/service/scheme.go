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

func (s *Service) canSkipScheme(ctx context.Context, userID uuid.UUID) bool {
	if s.identityURL == "" || s.internalToken == "" {
		return false
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.identityURL+"/v1/internal/entitlements/"+userID.String(), nil)
	if err != nil {
		return false
	}
	req.Header.Set("X-Internal-Token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode >= 300 {
		return false
	}
	var snap entitlement.Snapshot
	if err := json.Unmarshal(body, &snap); err != nil {
		return false
	}
	return snap.Has(entitlement.FeatureSkipServiceScheme)
}

func (s *Service) CompleteVisit(ctx context.Context, appointmentID, actorUserID uuid.UUID, scheme *VisitSchemeInput) (*domain.Appointment, error) {
	if scheme == nil {
		scheme = &VisitSchemeInput{}
	}
	if scheme.Skipped {
		if !s.canSkipScheme(ctx, actorUserID) {
			return nil, apperr.Forbidden("service scheme is required on the current plan")
		}
	} else {
		tech := strings.TrimSpace(scheme.Technique)
		hasComp := false
		for _, c := range scheme.Components {
			if strings.TrimSpace(c.Name) != "" {
				hasComp = true
				break
			}
		}
		if tech == "" && !hasComp {
			return nil, apperr.Validation("fill technique or at least one product/material")
		}
	}

	a, err := s.Complete(ctx, appointmentID, actorUserID)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	comps := make([]store.SchemeComponent, 0, len(scheme.Components))
	for _, c := range scheme.Components {
		if strings.TrimSpace(c.Name) == "" {
			continue
		}
		comps = append(comps, c)
	}
	if err := s.store.UpsertServiceScheme(ctx, store.ServiceScheme{
		AppointmentID: a.ID, Technique: strings.TrimSpace(scheme.Technique), Notes: strings.TrimSpace(scheme.Notes),
		CategoryFields: scheme.CategoryFields, Skipped: scheme.Skipped, CreatedBy: actorUserID, Components: comps,
	}, now); err != nil {
		return nil, apperr.Internal(err)
	}
	_ = s.store.AddBookingAudit(ctx, actorUserID, "scheme.saved", "appointment", a.ID, fmt.Sprintf(`{"skipped":%v}`, scheme.Skipped), now)
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

func (s *Service) CreatePlannerBlock(ctx context.Context, actor uuid.UUID, title, category, timezone, color string, starts, ends time.Time, orgID *uuid.UUID) (*store.PlannerBlock, error) {
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
	now := s.now().UTC()
	b := store.PlannerBlock{
		ID: ids.New(), OwnerUserID: actor, OrganizationID: orgID, Title: title,
		Category: strings.TrimSpace(category), StartsAt: starts.UTC(), EndsAt: ends.UTC(),
		Timezone: timezone, Color: colorOrDefault(color), CreatedAt: now, UpdatedAt: now,
	}
	if err := s.store.InsertPlannerBlock(ctx, b); err != nil {
		return nil, apperr.Internal(err)
	}
	return &b, nil
}

func (s *Service) ListPlannerBlocks(ctx context.Context, actor uuid.UUID, from, to time.Time) ([]store.PlannerBlock, error) {
	if to.Before(from) {
		return nil, apperr.Validation("invalid range")
	}
	items, err := s.store.ListPlannerBlocks(ctx, actor, from, to)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return items, nil
}

func (s *Service) MovePlannerBlock(ctx context.Context, actor, id uuid.UUID, starts, ends time.Time) (*store.PlannerBlock, error) {
	if !ends.After(starts) {
		return nil, apperr.Validation("ends_at must be after starts_at")
	}
	b, err := s.store.GetPlannerBlock(ctx, id)
	if err != nil {
		return nil, apperr.NotFound("block not found")
	}
	if b.OwnerUserID != actor {
		return nil, apperr.Forbidden("access denied")
	}
	now := s.now().UTC()
	if err := s.store.UpdatePlannerBlockTimes(ctx, id, starts.UTC(), ends.UTC(), now); err != nil {
		return nil, apperr.Internal(err)
	}
	b.StartsAt = starts.UTC()
	b.EndsAt = ends.UTC()
	b.UpdatedAt = now
	return b, nil
}

func (s *Service) DeletePlannerBlock(ctx context.Context, actor, id uuid.UUID) error {
	if err := s.store.DeletePlannerBlock(ctx, id, actor); err != nil {
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
