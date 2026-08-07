package domain

import (
	"time"

	"github.com/google/uuid"
)

const (
	RoleSystemAdmin = "system_admin"
	RoleClient      = "client"
	RoleMaster      = "master"
	RoleSalonOwner  = "salon_owner"
)

type User struct {
	ID            uuid.UUID
	Email         *string
	Phone         *string
	PasswordHash  string
	DisplayName   string
	City          string
	Status        string
	EmailVerified bool
	PhoneVerified bool
	Roles         []string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type Session struct {
	ID               uuid.UUID
	UserID           uuid.UUID
	RefreshTokenHash string
	FamilyID         uuid.UUID
	UserAgent        *string
	IP               *string
	ExpiresAt        time.Time
	RevokedAt        *time.Time
	CreatedAt        time.Time
}
