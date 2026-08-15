package domain

import (
	"time"

	"github.com/google/uuid"
)

type Organization struct {
	ID                        uuid.UUID
	Name                      string
	Description               string
	Type                      string
	Status                    string
	Published                 bool
	LogoMediaID               *uuid.UUID
	DeliveryNote              string
	MastersSeeClientContacts  bool
	CreatedBy                 uuid.UUID
	CreatedAt                 time.Time
	UpdatedAt                 time.Time
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
	Active            bool
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type SupplierRepresentative struct {
	ID             uuid.UUID
	OrganizationID uuid.UUID
	UserID         uuid.UUID
	City           string
	Territory      string
	Active         bool
	SalonBranchIDs []uuid.UUID
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type RepresentativeTask struct {
	ID               uuid.UUID
	OrganizationID   uuid.UUID
	RepresentativeID uuid.UUID
	BranchID         *uuid.UUID
	Title            string
	Description      string
	DueAt            *time.Time
	Priority         string
	Status           string
	ResultComment    string
	CreatedBy        uuid.UUID
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type FieldRoute struct {
	ID               uuid.UUID
	OrganizationID   uuid.UUID
	RepresentativeID uuid.UUID
	PlannedDate      time.Time
	Status           string
	TotalKm          float64
	TotalMinutes     int
	Provider         string
	Stops            []FieldRouteStop
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type FieldRouteStop struct {
	ID                  uuid.UUID
	RouteID             uuid.UUID
	Kind                string
	BranchID            *uuid.UUID
	DeliveryID          *uuid.UUID
	TaskID              *uuid.UUID
	Latitude            *float64
	Longitude           *float64
	DeadlineAt          *time.Time
	WindowStart         *time.Time
	WindowEnd           *time.Time
	Priority            string
	ExpectedDurationMin int
	Status              string
	SortOrder           int
	KmFromPrev          float64
	ETAAt               *time.Time
	CreatedAt           time.Time
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
