package domain

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

const (
	ConsultDraft          = "draft"
	ConsultAwaitingMaster = "awaiting_master"
	ConsultInProgress     = "in_progress"
	ConsultAwaitingClient = "awaiting_client"
	ConsultApproved       = "approved"
	ConsultClosed         = "closed"

	VerDraft            = "draft"
	VerSubmitted        = "submitted"
	VerInReview         = "in_review"
	VerSent             = "sent"
	VerChangesRequested = "changes_requested"
	VerApproved         = "approved"
	VerSuperseded       = "superseded"

	SlotOverview  = "overview"
	SlotRoots     = "roots"
	SlotLength    = "length"
	SlotEnds      = "ends"
	SlotStrandA4  = "strand_a4"
	SlotReference = "reference"
)

type HairConsultation struct {
	ID               uuid.UUID
	ClientUserID     uuid.UUID
	MasterUserID     uuid.UUID
	OrganizationID   *uuid.UUID
	ClientCardID     *uuid.UUID
	Status           string
	CurrentVersionID *uuid.UUID
	ConversationID   *uuid.UUID
	CreatedAt        time.Time
	UpdatedAt        time.Time

	CurrentVersion *HairConsultationVersion
	Versions       []HairConsultationVersion
	Events         []HairConsultationEvent
	Media          []HairConsultationMedia
}

type HairConsultationVersion struct {
	ID                  uuid.UUID
	ConsultationID      uuid.UUID
	VersionNo           int
	Status              string
	ClientQuestionnaire json.RawMessage
	MasterAssessment    json.RawMessage
	Plan                json.RawMessage
	ClientComment       string
	CreatedBy           uuid.UUID
	SubmittedAt         *time.Time
	SentAt              *time.Time
	ApprovedAt          *time.Time
	ImmutableAt         *time.Time
	CreatedAt           time.Time
	UpdatedAt           time.Time
	Media               []HairConsultationMedia
}

type HairConsultationEvent struct {
	ID             uuid.UUID
	ConsultationID uuid.UUID
	VersionID      *uuid.UUID
	ActorUserID    uuid.UUID
	Action         string
	FromStatus     *string
	ToStatus       string
	Meta           json.RawMessage
	CreatedAt      time.Time
}

type HairConsultationMedia struct {
	ID        uuid.UUID
	VersionID uuid.UUID
	MediaID   uuid.UUID
	Slot      string
	UploadedBy uuid.UUID
	CreatedAt time.Time
}

func ValidConsultStatus(s string) bool {
	switch s {
	case ConsultDraft, ConsultAwaitingMaster, ConsultInProgress, ConsultAwaitingClient, ConsultApproved, ConsultClosed:
		return true
	default:
		return false
	}
}

func ValidVersionStatus(s string) bool {
	switch s {
	case VerDraft, VerSubmitted, VerInReview, VerSent, VerChangesRequested, VerApproved, VerSuperseded:
		return true
	default:
		return false
	}
}

func ValidMediaSlot(s string) bool {
	switch s {
	case SlotOverview, SlotRoots, SlotLength, SlotEnds, SlotStrandA4, SlotReference:
		return true
	default:
		return false
	}
}

func VersionImmutable(v *HairConsultationVersion) bool {
	if v == nil {
		return false
	}
	return v.ImmutableAt != nil || v.Status == VerApproved || v.Status == VerSuperseded
}
