package domain

import (
	"time"

	"github.com/google/uuid"
)

const (
	StatusDraft     = "draft"
	StatusPublished = "published"
	StatusClosed    = "closed"
	StatusCancelled = "cancelled"

	RegRequested = "requested"
	RegConfirmed = "confirmed"
	RegCancelled = "cancelled"

	RespRequested = "requested"
	RespAccepted  = "accepted"
	RespCancelled = "cancelled"
)

type MasterclassEvent struct {
	ID               uuid.UUID
	InstructorUserID uuid.UUID
	InstructorName   string
	Title            string
	Description      string
	Category         string
	City             string
	LocationNote     string
	StartsAt         time.Time
	EndsAt           time.Time
	Timezone         string
	Capacity         int
	RegisteredCount  int
	Status           string
	CreatedAt        time.Time
	UpdatedAt        time.Time
	Relevant         bool
	MatchScore       int
}

type MasterclassInterest struct {
	ID           uuid.UUID
	MasterUserID uuid.UUID
	MasterName   string
	Category     string
	City         string
	DateFrom     time.Time
	DateTo       time.Time
	LocationNote string
	Status       string
	CreatedAt    time.Time
	MatchScore   int
}

type MasterclassRegistration struct {
	ID           uuid.UUID
	EventID      uuid.UUID
	MasterUserID uuid.UUID
	DisplayName  string
	Status       string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type ModelRequest struct {
	ID            uuid.UUID
	MasterUserID  uuid.UUID
	MasterName    string
	Category      string
	Title         string
	Description   string
	City          string
	LocationNote  string
	StartsAt      time.Time
	EndsAt        time.Time
	Timezone      string
	Capacity      int
	AcceptedCount int
	Status        string
	CreatedAt     time.Time
	UpdatedAt     time.Time
	Relevant      bool
	Interested    bool
	MatchScore    int
	MyResponse    *ModelResponse
}

type ModelResponse struct {
	ID           uuid.UUID
	RequestID    uuid.UUID
	ClientUserID uuid.UUID
	DisplayName  string
	Status       string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// ModelRequestInterest is a soft interest in a model_request (not a response/slot).
type ModelRequestInterest struct {
	UserID    uuid.UUID
	RequestID uuid.UUID
	CreatedAt time.Time
	// Joined request fields for list/overlap checks.
	Title    string
	StartsAt time.Time
	EndsAt   time.Time
	Status   string
}

// IntervalsOverlap reports whether two half-open-adjacent intervals collide.
// Touching endpoints (endA == startB) do not overlap.
func IntervalsOverlap(startA, endA, startB, endB time.Time) bool {
	return startA.Before(endB) && startB.Before(endA)
}
