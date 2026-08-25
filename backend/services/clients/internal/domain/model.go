package domain

import (
	"time"

	"github.com/google/uuid"
)

type ModelPreference struct {
	UserID     uuid.UUID
	Willing    bool
	Notify     bool
	Categories []string
	City       string
	DateFrom   *time.Time
	DateTo     *time.Time
	CreatedAt  time.Time
	UpdatedAt  time.Time
}
