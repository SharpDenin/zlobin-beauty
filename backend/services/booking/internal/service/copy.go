package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

const MaxCopyTargets = 14

type CopyTarget struct {
	StartsAt time.Time `json:"starts_at"`
}

type CopyItemError struct {
	StartsAt time.Time
	Err      error
}

type CopyAppointmentResult struct {
	Items  []domain.Appointment
	Errors []CopyItemError
}

func canCopyAppointment(a *domain.Appointment) error {
	if a == nil {
		return apperr.NotFound("appointment not found")
	}
	if a.BookingMode == domain.BookingModeFixedWindow {
		return apperr.ConflictCode(apperr.CodeAppointmentNotReschedulable, "fixed_window appointments cannot be copied")
	}
	switch a.Status {
	case domain.StatusPendingConfirmation, domain.StatusConfirmed, domain.StatusCompleted:
		return nil
	case domain.StatusInProgress:
		return apperr.ConflictCode(apperr.CodeAppointmentStatusInvalid, "cannot copy an in-progress appointment")
	}
	if strings.HasPrefix(a.Status, "cancelled_") || a.Status == domain.StatusNoShow {
		return apperr.ConflictCode(apperr.CodeAppointmentStatusInvalid, "cannot copy appointment in current status")
	}
	return apperr.ConflictCode(apperr.CodeAppointmentStatusInvalid, "cannot copy appointment in current status")
}

func (s *Service) resolveMasterProfileID(ctx context.Context, masterUserID uuid.UUID) (uuid.UUID, error) {
	payload, err := s.fetchMaster(ctx, masterUserID)
	if err != nil {
		return uuid.Nil, err
	}
	id, err := uuid.Parse(strings.TrimSpace(payload.Master.ID))
	if err != nil || id == uuid.Nil {
		return uuid.Nil, apperr.Internal(fmt.Errorf("bad master profile id"))
	}
	return id, nil
}

// CopyAppointment creates new appointments from a source visit via Create (FreeSlots, catalog pricing).
func (s *Service) CopyAppointment(ctx context.Context, appointmentID, actor uuid.UUID, targets []CopyTarget) (*CopyAppointmentResult, error) {
	if len(targets) == 0 {
		return nil, apperr.Validation("at least one target is required")
	}
	if len(targets) > MaxCopyTargets {
		return nil, apperr.Validation(fmt.Sprintf("at most %d targets allowed", MaxCopyTargets))
	}
	source, err := s.Get(ctx, appointmentID, actor)
	if err != nil {
		return nil, err
	}
	if err := canCopyAppointment(source); err != nil {
		return nil, err
	}
	masterProfileID, err := s.resolveMasterProfileID(ctx, source.MasterUserID)
	if err != nil {
		return nil, err
	}
	var districtID *uuid.UUID
	if source.OnsiteDistrictID != nil && *source.OnsiteDistrictID != uuid.Nil {
		districtID = source.OnsiteDistrictID
	}

	// Create auth: client rebooks as themselves; master/owner/admin book on behalf of the client
	// using the assigned master as actor (Create forbids other proxies).
	createActor := source.MasterUserID
	if actor == source.ClientUserID {
		createActor = source.ClientUserID
	}

	now := s.now().UTC()
	out := &CopyAppointmentResult{
		Items:  make([]domain.Appointment, 0, len(targets)),
		Errors: make([]CopyItemError, 0),
	}
	for _, t := range targets {
		startsAt := t.StartsAt.UTC()
		if !startsAt.After(now) {
			out.Errors = append(out.Errors, CopyItemError{
				StartsAt: startsAt,
				Err:      apperr.Validation("starts_at must be in the future"),
			})
			continue
		}
		created, err := s.Create(ctx, CreateInput{
			ClientUserID: source.ClientUserID,
			ActorUserID:  createActor,
			MasterID:     masterProfileID,
			ServiceID:    source.ServiceID,
			StartsAt:     startsAt,
			DistrictID:   districtID,
		})
		if err != nil {
			out.Errors = append(out.Errors, CopyItemError{StartsAt: startsAt, Err: err})
			continue
		}
		out.Items = append(out.Items, *created)
	}
	if len(out.Items) == 0 {
		if len(out.Errors) == 0 {
			return nil, apperr.Validation("no targets processed")
		}
		return nil, out.Errors[0].Err
	}
	return out, nil
}