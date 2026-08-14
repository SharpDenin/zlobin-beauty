package domain

import (
	"time"

	"github.com/google/uuid"
)

type Organization struct {
	ID           uuid.UUID
	Name         string
	Description  string
	Type         string
	Status       string
	Published    bool
	LogoMediaID  *uuid.UUID
	DeliveryNote string
	CreatedBy    uuid.UUID
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// SupplierListItem is a published supplier org with first-branch city for catalog UI.
type SupplierListItem struct {
	Organization
	City         string
	ProductCount int64
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
	PickupEnabled     bool
	Latitude          *float64
	Longitude         *float64
	WorkingHoursNote  string
	PhotoMediaID      *uuid.UUID
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
