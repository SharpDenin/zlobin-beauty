package domain

import (
	"time"

	"github.com/google/uuid"
)

const (
	RoleSystemAdmin  = "system_admin"
	RoleClient       = "client"
	RoleMaster       = "master"
	RoleSupplier     = "supplier"
	RoleSupplierRep  = "supplier_rep"
	RoleSalonOwner   = "salon_owner"
	RoleSalonAdmin   = "salon_admin"
)

func HasAnyRole(roles []string, want ...string) bool {
	set := map[string]struct{}{}
	for _, r := range roles {
		set[r] = struct{}{}
	}
	if _, ok := set[RoleSystemAdmin]; ok {
		return true
	}
	for _, w := range want {
		if _, ok := set[w]; ok {
			return true
		}
	}
	return false
}

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

type Subscription struct {
	UserID         uuid.UUID
	Plan           string
	Status         string
	TrialStartedAt *time.Time
	TrialEndsAt    *time.Time
	StartedAt      *time.Time
	PaidUntil      *time.Time
	CancelledAt    *time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type DashboardLayout struct {
	UserID    uuid.UUID
	Widgets   []byte
	UpdatedAt time.Time
}

type HintPrefs struct {
	UserID        uuid.UUID
	HintsEnabled  bool
	Dismissed     []byte
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
	RotatedAt        *time.Time
	ReplacedBy       *uuid.UUID
	CreatedAt        time.Time
}
