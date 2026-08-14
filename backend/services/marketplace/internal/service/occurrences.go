package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
	"github.com/zlobin/zlobin-beauty/backend/shared/ids"
)

type CreateOccurrenceInput struct {
	ActorUserID     uuid.UUID
	ServiceID       uuid.UUID
	BranchID        *uuid.UUID
	StartsAt        time.Time
	EndsAt          time.Time
	Timezone        string
	Capacity        int
	BookingCutoffAt *time.Time
	Title           string
	Note            string
}

type UpdateOccurrenceInput struct {
	ActorUserID     uuid.UUID
	OccurrenceID    uuid.UUID
	BranchID        *uuid.UUID
	ClearBranch     bool
	StartsAt        *time.Time
	EndsAt          *time.Time
	Timezone        *string
	Capacity        *int
	BookingCutoffAt *time.Time
	ClearCutoff     bool
	Title           *string
	Note            *string
}

func (s *Service) requireServiceMasterOwner(ctx context.Context, actorUserID, serviceID uuid.UUID) (*domain.MasterProfile, *domain.ServiceItem, error) {
	master, err := s.store.GetMasterByUser(ctx, actorUserID)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if master == nil {
		return nil, nil, apperr.Forbidden("master profile required")
	}
	svc, err := s.store.GetService(ctx, serviceID)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if svc == nil {
		return nil, nil, apperr.NotFound("service not found")
	}
	ok, err := s.store.IsServiceAttachedToMaster(ctx, master.ID, serviceID)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	if !ok {
		return nil, nil, apperr.Forbidden("only the service master can manage occurrences")
	}
	return master, svc, nil
}

func validateOccurrenceWindow(starts, ends time.Time, tz string) (string, error) {
	if !ends.After(starts) {
		return "", apperr.Validation("ends_at must be after starts_at")
	}
	tz = strings.TrimSpace(tz)
	if tz == "" {
		tz = "Europe/Moscow"
	}
	if _, err := time.LoadLocation(tz); err != nil {
		return "", apperr.Validation("timezone must be a valid IANA name")
	}
	return tz, nil
}

func (s *Service) CreateOccurrence(ctx context.Context, in CreateOccurrenceInput) (*domain.ServiceOccurrence, error) {
	master, svc, err := s.requireServiceMasterOwner(ctx, in.ActorUserID, in.ServiceID)
	if err != nil {
		return nil, err
	}
	tz, err := validateOccurrenceWindow(in.StartsAt, in.EndsAt, in.Timezone)
	if err != nil {
		return nil, err
	}
	capacity := in.Capacity
	if capacity <= 0 {
		capacity = 1
	}
	overlap, err := s.store.HasOverlappingOccurrence(ctx, master.UserID, in.StartsAt.UTC(), in.EndsAt.UTC(), nil)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if overlap {
		return nil, apperr.Conflict("occurrence overlaps another active occurrence for this master")
	}
	now := s.now().UTC()
	o := domain.ServiceOccurrence{
		ID: ids.New(), ServiceID: in.ServiceID, MasterUserID: master.UserID, BranchID: in.BranchID,
		StartsAt: in.StartsAt.UTC(), EndsAt: in.EndsAt.UTC(), Timezone: tz,
		Capacity: capacity, BookedCount: 0, Status: "scheduled",
		BookingCutoffAt: in.BookingCutoffAt, Title: strings.TrimSpace(in.Title), Note: strings.TrimSpace(in.Note),
		CreatedAt: now, UpdatedAt: now,
	}
	if o.BranchID == nil && master.BranchID != nil {
		o.BranchID = master.BranchID
	}
	if err := s.store.CreateOccurrence(ctx, o); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	if svc.BookingMode == "fixed_window" && svc.DurationMinutes <= 0 {
		mins := int(o.EndsAt.Sub(o.StartsAt).Minutes())
		if mins > 0 {
			svc.DurationMinutes = mins
			svc.UpdatedAt = now
			_ = s.store.UpdateService(ctx, *svc)
		}
	}
	return &o, nil
}

func (s *Service) ListOccurrences(ctx context.Context, serviceID uuid.UUID, actorUserID *uuid.UUID) ([]domain.ServiceOccurrence, error) {
	svc, err := s.store.GetService(ctx, serviceID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if svc == nil {
		return nil, apperr.NotFound("service not found")
	}
	if actorUserID != nil {
		master, err := s.store.GetMasterByUser(ctx, *actorUserID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if master != nil {
			ok, err := s.store.IsServiceAttachedToMaster(ctx, master.ID, serviceID)
			if err != nil {
				return nil, apperr.Internal(err)
			}
			if ok {
				items, err := s.store.ListOccurrencesByService(ctx, serviceID)
				if err != nil {
					return nil, apperr.Internal(err)
				}
				return items, nil
			}
		}
	}
	items, err := s.store.ListPublicOccurrencesByService(ctx, serviceID, s.now().UTC())
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return items, nil
}

func (s *Service) GetOccurrence(ctx context.Context, id uuid.UUID) (*domain.ServiceOccurrence, error) {
	o, err := s.store.GetOccurrence(ctx, id)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if o == nil {
		return nil, apperr.NotFound("occurrence not found")
	}
	return o, nil
}

func (s *Service) UpdateOccurrence(ctx context.Context, in UpdateOccurrenceInput) (*domain.ServiceOccurrence, error) {
	o, err := s.store.GetOccurrence(ctx, in.OccurrenceID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if o == nil {
		return nil, apperr.NotFound("occurrence not found")
	}
	if _, _, err := s.requireServiceMasterOwner(ctx, in.ActorUserID, o.ServiceID); err != nil {
		return nil, err
	}
	if o.MasterUserID != in.ActorUserID {
		return nil, apperr.Forbidden("only the occurrence master can update it")
	}
	if o.Status == "cancelled" || o.Status == "completed" {
		return nil, apperr.Conflict("cannot update cancelled or completed occurrence")
	}
	if in.StartsAt != nil {
		o.StartsAt = in.StartsAt.UTC()
	}
	if in.EndsAt != nil {
		o.EndsAt = in.EndsAt.UTC()
	}
	tz := o.Timezone
	if in.Timezone != nil {
		tz = *in.Timezone
	}
	tz, err = validateOccurrenceWindow(o.StartsAt, o.EndsAt, tz)
	if err != nil {
		return nil, err
	}
	o.Timezone = tz
	if in.Capacity != nil {
		if *in.Capacity <= 0 {
			return nil, apperr.Validation("capacity must be positive")
		}
		if *in.Capacity < o.BookedCount {
			return nil, apperr.Validation("capacity cannot be less than booked_count")
		}
		o.Capacity = *in.Capacity
		if o.BookedCount >= o.Capacity {
			o.Status = "full"
		} else if o.Status == "full" {
			o.Status = "scheduled"
		}
	}
	if in.ClearBranch {
		o.BranchID = nil
	} else if in.BranchID != nil {
		o.BranchID = in.BranchID
	}
	if in.ClearCutoff {
		o.BookingCutoffAt = nil
	} else if in.BookingCutoffAt != nil {
		o.BookingCutoffAt = in.BookingCutoffAt
	}
	if in.Title != nil {
		o.Title = strings.TrimSpace(*in.Title)
	}
	if in.Note != nil {
		o.Note = strings.TrimSpace(*in.Note)
	}
	excludeID := o.ID
	overlap, err := s.store.HasOverlappingOccurrence(ctx, o.MasterUserID, o.StartsAt, o.EndsAt, &excludeID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if overlap {
		return nil, apperr.Conflict("occurrence overlaps another active occurrence for this master")
	}
	o.UpdatedAt = s.now().UTC()
	if err := s.store.UpdateOccurrence(ctx, *o); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return o, nil
}

func (s *Service) CancelOccurrence(ctx context.Context, actorUserID, occurrenceID uuid.UUID) (*domain.ServiceOccurrence, error) {
	o, err := s.store.GetOccurrence(ctx, occurrenceID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if o == nil {
		return nil, apperr.NotFound("occurrence not found")
	}
	if _, _, err := s.requireServiceMasterOwner(ctx, actorUserID, o.ServiceID); err != nil {
		return nil, err
	}
	if o.MasterUserID != actorUserID {
		return nil, apperr.Forbidden("only the occurrence master can cancel it")
	}
	if err := s.store.CancelOccurrence(ctx, occurrenceID, s.now().UTC()); err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	o.Status = "cancelled"
	o.UpdatedAt = s.now().UTC()
	return o, nil
}

func (s *Service) TryBookOccurrence(ctx context.Context, id uuid.UUID) (*domain.ServiceOccurrence, error) {
	o, err := s.store.TryBookOccurrence(ctx, id)
	if err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return o, nil
}

func (s *Service) ReleaseOccurrenceSlot(ctx context.Context, id uuid.UUID) (*domain.ServiceOccurrence, error) {
	o, err := s.store.ReleaseOccurrenceSlot(ctx, id)
	if err != nil {
		if ae, ok := apperr.As(err); ok {
			return nil, ae
		}
		return nil, apperr.Internal(err)
	}
	return o, nil
}
