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

	BookingModeFlexible    = "flexible"
	BookingModeFixedWindow = "fixed_window"
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
		return apperr.ConflictCode(apperr.CodeAppointmentStatusInvalid, "invalid appointment status transition")
	}
	return nil
}

// CanReschedule reports whether a live appointment may change date/time.
// Fixed-window occurrences keep their published interval; terminal statuses cannot move.
func CanReschedule(status, bookingMode string) bool {
	if bookingMode == BookingModeFixedWindow {
		return false
	}
	return status == StatusPendingConfirmation || status == StatusConfirmed
}

type WorkingHours struct {
	ID           uuid.UUID
	MasterUserID uuid.UUID
	Weekday      int
	StartMinute  int
	EndMinute    int
}

// ScheduleException overrides weekly working hours for a concrete calendar day.
type ScheduleException struct {
	ID           uuid.UUID
	MasterUserID uuid.UUID
	Day          time.Time // date (UTC midnight of the calendar day)
	IsDayOff     bool
	StartMinute  *int
	EndMinute    *int
	Note         string
	CreatedAt    time.Time
}

type Appointment struct {
	ID                 uuid.UUID
	OrganizationID     uuid.UUID
	BranchID           uuid.UUID
	MasterUserID       uuid.UUID
	ClientUserID       uuid.UUID
	ServiceID          uuid.UUID
	ServiceName        string
	DurationMinutes    int
	PriceMinor         int64
	Currency           string
	Status             string
	CancelReason       string
	StartsAt           time.Time
	EndsAt             time.Time
	OccurrenceID       *uuid.UUID
	BookingMode        string
	LocationName       string
	LocationCity       string
	LocationAddress    string
	LocationTimezone   string
	WorkMode           string
	WorkModeIntervalID *uuid.UUID
	ChairID            *uuid.UUID
	OnsiteCityID       *uuid.UUID
	OnsiteDistrictID   *uuid.UUID
	VisitGroupID       *uuid.UUID
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// IdempotencyRecord stores a prior successful response for a client retry.
type IdempotencyRecord struct {
	Key            string
	UserID         uuid.UUID
	Operation      string
	EntityID       *uuid.UUID
	ResponseStatus int
	ExpiresAt      time.Time
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
