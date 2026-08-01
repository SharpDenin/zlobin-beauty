package domain

import (
	"time"

	"github.com/google/uuid"
)

type MasterProfile struct {
	ID               uuid.UUID
	UserID           uuid.UUID
	OrganizationID   uuid.UUID
	BranchID         *uuid.UUID
	DisplayName      string
	Bio              string
	Specializations  []string
	City             string
	RatingAvg        float64
	RatingCount      int
	Published        bool
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type ServiceItem struct {
	ID              uuid.UUID
	OrganizationID  uuid.UUID
	Name            string
	Category        string
	DurationMinutes int
	PriceMinor      int64
	Currency        string
	Published       bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}
