package service

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestCanCopyAppointment(t *testing.T) {
	flex := domain.BookingModeFlexible
	fixed := domain.BookingModeFixedWindow

	cases := []struct {
		name    string
		a       *domain.Appointment
		wantErr bool
		code    apperr.Code
	}{
		{"nil", nil, true, apperr.CodeNotFound},
		{"pending", &domain.Appointment{Status: domain.StatusPendingConfirmation, BookingMode: flex}, false, ""},
		{"confirmed", &domain.Appointment{Status: domain.StatusConfirmed, BookingMode: flex}, false, ""},
		{"completed", &domain.Appointment{Status: domain.StatusCompleted, BookingMode: flex}, false, ""},
		{"fixed_window", &domain.Appointment{Status: domain.StatusConfirmed, BookingMode: fixed}, true, apperr.CodeAppointmentNotReschedulable},
		{"in_progress", &domain.Appointment{Status: domain.StatusInProgress, BookingMode: flex}, true, apperr.CodeAppointmentStatusInvalid},
		{"cancelled_client", &domain.Appointment{Status: domain.StatusCancelledByClient, BookingMode: flex}, true, apperr.CodeAppointmentStatusInvalid},
		{"no_show", &domain.Appointment{Status: domain.StatusNoShow, BookingMode: flex}, true, apperr.CodeAppointmentStatusInvalid},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := canCopyAppointment(tc.a)
			if !tc.wantErr {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatal("expected error")
			}
			if tc.code != "" {
				ae, ok := apperr.As(err)
				if !ok {
					t.Fatalf("not apperr: %v", err)
				}
				if ae.Code != tc.code {
					t.Fatalf("code=%s want %s", ae.Code, tc.code)
				}
			}
		})
	}
}

func TestCopyAppointmentRejectsEmptyTargets(t *testing.T) {
	s := &Service{now: time.Now}
	_, err := s.CopyAppointment(context.Background(), uuid.Nil, uuid.Nil, nil)
	if err == nil {
		t.Fatal("expected validation error")
	}
	ae, ok := apperr.As(err)
	if !ok || ae.HTTPStatus != 400 {
		t.Fatalf("want validation, got %v", err)
	}
}