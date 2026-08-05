package domain

import (
	"time"

	"github.com/google/uuid"
)

type Notification struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	Type       string
	Title      string
	Body       string
	EntityType string
	EntityID   *uuid.UUID
	ReadAt     *time.Time
	CreatedAt  time.Time
}

type Review struct {
	ID             uuid.UUID
	AppointmentID  uuid.UUID
	ClientUserID   uuid.UUID
	MasterUserID   uuid.UUID
	MasterRating   int
	ResultRating   int
	Comment        string
	PublishAllowed bool
	Hidden         bool
	CreatedAt      time.Time
}
