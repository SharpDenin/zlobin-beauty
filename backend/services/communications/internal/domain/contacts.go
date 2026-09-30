package domain

import (
	"time"

	"github.com/google/uuid"
)

const MaxContactNoteRunes = 200

type Contact struct {
	ID            uuid.UUID
	OwnerUserID   uuid.UUID
	ContactUserID uuid.UUID
	Note          string
	CreatedAt     time.Time
}

type ContactView struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	DisplayName     string
	Roles           []string
	City            string
	AvatarMediaID   *uuid.UUID
	Note            string
	ConversationID  *uuid.UUID
	CreatedAt       time.Time
}

type ContactSearchHit struct {
	ID            uuid.UUID
	DisplayName   string
	Roles         []string
	City          string
	AvatarMediaID *uuid.UUID
	AlreadyAdded  bool
}
