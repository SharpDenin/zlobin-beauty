package domain

import (
	"time"

	"github.com/google/uuid"
)

type Organization struct {
	ID        uuid.UUID
	Name      string
	Type      string
	Status    string
	CreatedBy uuid.UUID
	CreatedAt time.Time
	UpdatedAt time.Time
}

type Branch struct {
	ID                uuid.UUID
	OrganizationID    uuid.UUID
	Name              string
	City              string
	AddressLine       string
	Timezone          string
	CancelWindowHours int
	AutoConfirm       bool
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type Membership struct {
	ID             uuid.UUID
	OrganizationID uuid.UUID
	UserID         uuid.UUID
	Role           string
	Status         string
	CreatedAt      time.Time
}
