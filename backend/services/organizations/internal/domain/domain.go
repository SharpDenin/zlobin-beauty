package domain

import (
	"time"

	"github.com/google/uuid"
)

type Organization struct {
	ID          uuid.UUID
	Name        string
	Description string
	Type        string
	Status      string
	Published   bool
	CreatedBy   uuid.UUID
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type Branch struct {
	ID                uuid.UUID
	OrganizationID    uuid.UUID
	Name              string
	City              string
	AddressLine       string
	Phone             string
	Timezone          string
	CancelWindowHours int
	AutoConfirm       bool
	Published         bool
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type ReadinessCheck struct {
	Key     string `json:"key"`
	Label   string `json:"label"`
	OK      bool   `json:"ok"`
	Missing string `json:"missing,omitempty"`
}

type Readiness struct {
	Ready   bool             `json:"ready"`
	Missing []string         `json:"missing"`
	Checks  []ReadinessCheck `json:"checks"`
}

type Membership struct {
	ID             uuid.UUID
	OrganizationID uuid.UUID
	UserID         uuid.UUID
	Role           string
	Status         string
	CreatedAt      time.Time
}

type BranchPhoto struct {
	ID        uuid.UUID
	BranchID  uuid.UUID
	MediaID   uuid.UUID
	SortOrder int
	CreatedAt time.Time
}
