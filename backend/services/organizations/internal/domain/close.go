package domain

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

const (
	BranchCloseRunning   = "running"
	BranchCloseCompleted = "completed"
	BranchCloseFailed    = "failed"
	BranchCloseBlocked   = "blocked"

	BranchCloseCancelReason = "филиал закрыт"
)

type BranchCloseBlocker struct {
	Code  string `json:"code"`
	Label string `json:"label"`
	Count int    `json:"count"`
	Href  string `json:"href,omitempty"`
}

type BranchCloseJob struct {
	ID                 uuid.UUID
	BranchID           uuid.UUID
	OrganizationID     uuid.UUID
	ActorUserID        uuid.UUID
	Status             string
	ContactPhone       string
	ContactSource      string
	FutureAppointments int
	MastersAffected    int
	LastActiveBranch   bool
	OrgUnpublished     bool
	ErrorMessage       string
	BlockersJSON       json.RawMessage
	ResultJSON         json.RawMessage
	CreatedAt          time.Time
	UpdatedAt          time.Time
	CompletedAt        *time.Time
}

type BranchClosePreflight struct {
	BranchID             uuid.UUID
	BranchName           string
	OrganizationID       uuid.UUID
	OrganizationName     string
	Active               bool
	AlreadyClosed        bool
	FutureAppointments   int
	MastersAffected      int
	MastersPrivatePath   int
	MastersUnlinkOnly    int
	LastActiveBranch     bool
	WillUnpublishOrg     bool
	ContactPhone         string
	ContactSource        string
	ContactDisplay       string
	Blockers             []BranchCloseBlocker
	CanClose             bool
	CompletedJobID       *uuid.UUID
	LatestJobID          *uuid.UUID
	LatestJobStatus      string
	LatestJobError       string
}
