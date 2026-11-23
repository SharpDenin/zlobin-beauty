package domain

import (
	"time"

	"github.com/google/uuid"
)

// ClientInvite is a master-issued token that a client accepts to link contacts (+ optional CRM card).
type ClientInvite struct {
	ID             uuid.UUID
	MasterUserID   uuid.UUID
	OrganizationID *uuid.UUID
	TokenHash      string
	ExpiresAt      time.Time
	MaxUses        int
	UseCount       int
	RevokedAt      *time.Time
	CreatedAt      time.Time
}

// ClientInviteAccept is the durable one-time accept ledger + history snapshot.
type ClientInviteAccept struct {
	ID                  uuid.UUID
	InviteID            uuid.UUID
	UserID              uuid.UUID
	DisplayNameSnapshot string
	AcceptedAt          time.Time
}

// ClientInviteHistoryRow is invite + optional accept for UI history.
type ClientInviteHistoryRow struct {
	Invite              ClientInvite
	AcceptedAt          *time.Time
	AcceptedUserID      *uuid.UUID
	DisplayNameSnapshot *string
	Status              string // active | accepted | revoked | expired | exhausted
}
