package ids

import (
	"github.com/google/uuid"
)

func New() uuid.UUID {
	return uuid.Must(uuid.NewV7())
}

func Parse(s string) (uuid.UUID, error) {
	return uuid.Parse(s)
}
