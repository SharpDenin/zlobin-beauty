package store

import (
	"context"

	"github.com/google/uuid"
)

// AppointmentIDsForMedia returns appointments that reference a media object as a photo.
func (s *Store) AppointmentIDsForMedia(ctx context.Context, mediaID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `SELECT DISTINCT appointment_id FROM appointment_photos WHERE media_id=$1`, mediaID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
