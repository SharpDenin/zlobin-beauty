package domain

import (
	"time"

	"github.com/google/uuid"
)

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
	RatingAvg       float64
	RatingCount     int
	Published       bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
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
	DurationMinutes int
	PriceMinor      int64
	Currency        string
	Published       bool
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

type KnowledgeArticle struct {
	ID           uuid.UUID
	Title        string
	Category     string
	Content      string
	AuthorUserID uuid.UUID
	AuthorOrgID  *uuid.UUID
	AuthorName   string
	Published    bool
	CreatedAt    time.Time
	UpdatedAt    time.Time
}
