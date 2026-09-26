package domain

import (
	"time"

	"github.com/google/uuid"
)

type ProfessionType struct {
	ID        uuid.UUID
	Slug      string
	Name      string
	IsActive  bool
	LockedAt  *time.Time
	CreatedAt time.Time
	UpdatedAt time.Time
}

type MasterProfileType struct {
	ID               uuid.UUID
	MasterUserID     uuid.UUID
	ProfessionTypeID uuid.UUID
	LockedAt         *time.Time
	CreatedAt        time.Time
	Type             ProfessionType
}

type MasterProfile struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	OrganizationID  uuid.UUID
	BranchID        *uuid.UUID
	DisplayName     string
	Bio             string
	Specializations []string
	City            string
	ExperienceYears int
	Education       string
	PhotoMediaID    *uuid.UUID
	WorkType        string
	RatingAvg       float64
	RatingCount     int
	Published       bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
	ProfessionTypes []ProfessionType
}

type ServiceCategory struct {
	ID        uuid.UUID
	Name      string
	Slug      string
	SortOrder int
	CreatedAt time.Time
}

type ServiceItem struct {
	ID              uuid.UUID
	OrganizationID  uuid.UUID
	BranchID        *uuid.UUID // optional: set when joined with a published master for public listing filters
	Name            string
	Category        string
	Description     string
	Notes           string
	DurationMinutes int
	PriceMinor      int64
	Currency        string
	PhotoMediaID    *uuid.UUID
	BookingMode     string // flexible | fixed_window
	Published       bool
	ArchivedAt      *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type ServiceOccurrence struct {
	ID              uuid.UUID
	ServiceID       uuid.UUID
	MasterUserID    uuid.UUID
	BranchID        *uuid.UUID
	StartsAt        time.Time
	EndsAt          time.Time
	Timezone        string
	Capacity        int
	BookedCount     int
	Status          string // scheduled | cancelled | completed | full
	BookingCutoffAt *time.Time
	Title           string
	Note            string
	CreatedAt       time.Time
	UpdatedAt       time.Time
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

type PortfolioItem struct {
	ID        uuid.UUID
	MasterID  uuid.UUID
	MediaID   uuid.UUID
	Caption   string
	SortOrder int
	CreatedAt time.Time
}

const (
	KnowledgeStatusDraft     = "draft"
	KnowledgeStatusPublished = "published"
	KnowledgeStatusArchived  = "archived"
)

type KnowledgeArticle struct {
	ID                 uuid.UUID
	Title              string
	Category           string
	Content            string
	ContentFormat      string // plain | doc_json
	CoverMediaID       *uuid.UUID
	ReadingTimeMinutes int
	Brand              string
	ProductID          *uuid.UUID
	ProductIDs         []uuid.UUID
	CategoryIDs        []uuid.UUID
	AuthorUserID       uuid.UUID
	AuthorOrgID        *uuid.UUID
	AuthorName         string
	Status             string
	Published          bool
	PublishedAt        *time.Time
	ViewCount          int
	Favorite           bool
	ArchivedAt         *time.Time
	CreatedAt          time.Time
	UpdatedAt          time.Time
	// Computed from linked product.audience; not stored.
	HomeCare     bool
	Professional bool
	AudienceKind string
}
