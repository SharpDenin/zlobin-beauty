package domain

import (
	"time"

	"github.com/google/uuid"
)

const (
	WorkModePercentage = "percentage"
	WorkModeChair      = "chair"
	WorkModeOnsite     = "onsite"

	ChairStatusActive   = "active"
	ChairStatusInactive = "inactive"

	LeaseRequested = "requested"
	LeaseActive    = "active"
	LeaseRejected  = "rejected"
	LeaseCancelled = "cancelled"
	LeaseExpired   = "expired"

	PercentageBasisServicePrice = "service_price"
)

type GeoCity struct {
	ID       uuid.UUID
	Name     string
	Timezone string
}

type GeoDistrict struct {
	ID     uuid.UUID
	CityID uuid.UUID
	Name   string
}

type SalonChair struct {
	ID             uuid.UUID
	OrganizationID uuid.UUID
	BranchID       uuid.UUID
	Name           string
	Description    string
	Status         string
	ListedForRent  bool
	RentNote       string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type ChairLease struct {
	ID             uuid.UUID
	ChairID        uuid.UUID
	OrganizationID uuid.UUID
	RenterUserID   uuid.UUID
	StartsAt       time.Time
	EndsAt         time.Time
	Status         string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	Chair          *SalonChair
}

type WorkModeInterval struct {
	ID              uuid.UUID
	MasterUserID    uuid.UUID
	Mode            string
	StartsAt        time.Time
	EndsAt          time.Time
	Timezone        string
	OrganizationID  *uuid.UUID
	BranchID        *uuid.UUID
	ChairID         *uuid.UUID
	PercentageRate  *float64
	CityID          *uuid.UUID
	CreatedAt       time.Time
	UpdatedAt       time.Time
	Districts       []GeoDistrict
	Chair           *SalonChair
	City            *GeoCity
}

func ValidWorkMode(mode string) bool {
	switch mode {
	case WorkModePercentage, WorkModeChair, WorkModeOnsite:
		return true
	default:
		return false
	}
}

func WorkModeLabel(mode string) string {
	switch mode {
	case WorkModePercentage:
		return "На процентах"
	case WorkModeChair:
		return "В салоне"
	case WorkModeOnsite:
		return "Выезд"
	default:
		return mode
	}
}
