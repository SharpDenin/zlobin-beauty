package domain

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type ClientCard struct {
	ID             uuid.UUID
	OrganizationID uuid.UUID
	UserID         uuid.UUID
	DisplayName    string
	Phone          *string
	Email          *string
	Preferences    string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	ContactsHidden bool
}

// ClientCardListItem is a card with visit aggregates for master CRM segments.
type ClientCardListItem struct {
	Card         ClientCard
	Segment      string // new | active | lapsed | unknown
	VisitCount   int
	LastVisitAt  *time.Time
	FirstVisitAt *time.Time
}

type Visit struct {
	ID             uuid.UUID
	ClientCardID   uuid.UUID
	AppointmentID  uuid.UUID
	OrganizationID uuid.UUID
	MasterUserID   uuid.UUID
	ServiceName    string
	PriceMinor     int64
	Currency       string
	StartedAt      time.Time
	CompletedAt    time.Time
	CreatedAt      time.Time
}

type VisitNote struct {
	ID           uuid.UUID
	VisitID      uuid.UUID
	AuthorUserID uuid.UUID
	Body         string
	CreatedAt    time.Time
}

type ColorFormula struct {
	ID           uuid.UUID
	ClientCardID uuid.UUID
	VisitID      *uuid.UUID
	Name         string
	Brand        string
	Components   json.RawMessage
	Oxidizer     string
	Ratio        string
	Comment      string
	CreatedBy    uuid.UUID
	CreatedAt    time.Time
	OmitFormula  bool
	Redacted     bool
}

const (
	DisputeOpen     = "open"
	DisputeResolved = "resolved"
	DisputeRejected = "rejected"
)

type CardDispute struct {
	ID             uuid.UUID
	ClientCardID   uuid.UUID
	ReporterUserID uuid.UUID
	FieldKey       string
	Comment        string
	Status         string
	CreatedAt      time.Time
	ResolvedAt     *time.Time
	ResolvedBy     *uuid.UUID
}

type DisputeEvent struct {
	ID          uuid.UUID
	DisputeID   uuid.UUID
	ActorUserID uuid.UUID
	Action      string
	FromStatus  *string
	ToStatus    string
	Meta        json.RawMessage
	CreatedAt   time.Time
}

func AllowedDisputeField(key string) bool {
	switch key {
	case "hair_color", "hair_condition", "preferences", "display_name", "phone", "email":
		return true
	default:
		return false
	}
}

type Consent struct {
	ID           uuid.UUID
	ClientCardID uuid.UUID
	ConsentType  string
	Granted      bool
	CreatedAt    time.Time
}
