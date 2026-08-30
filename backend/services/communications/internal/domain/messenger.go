package domain

import (
	"time"

	"github.com/google/uuid"
)

const (
	ConversationClientMaster   = "client_master"
	ConversationMasterSupplier = "master_supplier"
	ConversationMasterclass    = "masterclass"
	ConversationModelRequest   = "model_request"

	MessageKindText  = "text"
	MessageKindImage = "image"
	MessageKindVideo = "video"

	MaxMessageRunes = 4000
)

type Conversation struct {
	ID          uuid.UUID
	Type        string
	ContextKey  string
	ContextType string
	ContextID   *uuid.UUID
	CreatedAt   time.Time
	UpdatedAt   time.Time
	Participants []Participant
	LastMessage  *Message
	UnreadCount  int
}

type Participant struct {
	ConversationID  uuid.UUID
	UserID          uuid.UUID
	ParticipantRole string
	JoinedAt        time.Time
	LastReadAt      *time.Time
	DisplayName     string
}

type Message struct {
	ID             uuid.UUID
	ConversationID uuid.UUID
	SenderUserID   uuid.UUID
	Kind           string
	Body           string
	MediaID        *uuid.UUID
	CreatedAt      time.Time
	EditedAt       *time.Time
	DeletedAt      *time.Time
}
