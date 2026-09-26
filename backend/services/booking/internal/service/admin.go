package service

import (
	"context"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/store"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func (s *Service) AdminListAppointments(ctx context.Context, f store.AppointmentListFilter) ([]domain.Appointment, int, error) {
	items, err := s.store.ListAppointmentsAdmin(ctx, f)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	total, err := s.store.CountAppointmentsAdmin(ctx, f)
	if err != nil {
		return nil, 0, apperr.Internal(err)
	}
	return items, total, nil
}

func (s *Service) AdminGetAppointment(ctx context.Context, id uuid.UUID) (*domain.Appointment, []domain.Appointment, []domain.StatusHistory, error) {
	a, err := s.store.GetAppointment(ctx, id)
	if err != nil {
		return nil, nil, nil, apperr.Internal(err)
	}
	if a == nil {
		return nil, nil, nil, apperr.NotFound("appointment not found")
	}
	var group []domain.Appointment
	if a.VisitGroupID != nil {
		group, err = s.store.ListByVisitGroup(ctx, *a.VisitGroupID)
		if err != nil {
			return nil, nil, nil, apperr.Internal(err)
		}
	}
	if group == nil {
		group = []domain.Appointment{*a}
	}
	history, err := s.store.ListHistory(ctx, id)
	if err != nil {
		return nil, nil, nil, apperr.Internal(err)
	}
	if history == nil {
		history = []domain.StatusHistory{}
	}
	return a, group, history, nil
}

func (s *Service) AdminAppointmentStats(ctx context.Context) (store.BookingStats, error) {
	st, err := s.store.AppointmentStats(ctx)
	if err != nil {
		return st, apperr.Internal(err)
	}
	return st, nil
}

func (s *Service) AdminWorkingHours(ctx context.Context, masterUserID uuid.UUID) ([]domain.WorkingHours, error) {
	hours, err := s.store.ListWorkingHours(ctx, masterUserID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if hours == nil {
		hours = []domain.WorkingHours{}
	}
	return hours, nil
}
