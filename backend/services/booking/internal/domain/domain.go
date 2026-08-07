package domain

import (
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

const (
	StatusPendingConfirmation = "pending_confirmation"
	StatusConfirmed           = "confirmed"
	StatusInProgress          = "in_progress"
	StatusCompleted           = "completed"
	StatusCancelledByClient   = "cancelled_by_client"
	StatusCancelledByMaster   = "cancelled_by_master"
	StatusCancelledBySalon    = "cancelled_by_salon"
	StatusNoShow              = "no_show"
)

var allowedTransitions = map[string]map[string]struct{}{
	StatusPendingConfirmation: {
		StatusConfirmed: {}, StatusCancelledByClient: {}, StatusCancelledByMaster: {}, StatusCancelledBySalon: {},
	},
	StatusConfirmed: {
		StatusInProgress: {}, StatusCancelledByClient: {}, StatusCancelledByMaster: {}, StatusCancelledBySalon: {}, StatusNoShow: {},
	},
	StatusInProgress: {
		StatusCompleted: {}, StatusCancelledByMaster: {}, StatusCancelledBySalon: {},
	},
}

func CanTransition(from, to string) bool {
	next, ok := allowedTransitions[from]
	if !ok {
		return false
	}
	_, ok = next[to]
	return ok
}

func Transition(from, to string) error {
	if !CanTransition(from, to) {
		return apperr.Conflict("invalid appointment status transition")
	}
	return nil
}

type WorkingHours struct {
	ID           uuid.UUID
	MasterUserID uuid.UUID
	Weekday      int
	StartMinute  int
	EndMinute    int
}

type Appointment struct {
	ID              uuid.UUID
	OrganizationID  uuid.UUID
	BranchID        uuid.UUID
	MasterUserID    uuid.UUID
	ClientUserID    uuid.UUID
	ServiceID       uuid.UUID
	ServiceName     string
	DurationMinutes int
	PriceMinor      int64
	Currency        string
	Status          string
	CancelReason    string
	StartsAt        time.Time
	EndsAt          time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type StatusHistory struct {
	ID            uuid.UUID
	AppointmentID uuid.UUID
	FromStatus    *string
	ToStatus      string
	ActorUserID   uuid.UUID
	Reason        string
	CreatedAt     time.Time
}

type AppointmentPhoto struct {
	ID            uuid.UUID
	AppointmentID uuid.UUID
	MediaID       uuid.UUID
	Kind          string // before | after
	CreatedBy     uuid.UUID
	CreatedAt     time.Time
}
