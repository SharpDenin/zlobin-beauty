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
