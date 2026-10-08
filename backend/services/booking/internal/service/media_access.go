package service

import (
	"context"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

// MediaVisibleToUser tells the media service whether userID may see a before/after photo:
// only people who may open one of the appointments the photo is attached to.
func (s *Service) MediaVisibleToUser(ctx context.Context, mediaID, userID uuid.UUID) (bool, error) {
	appointmentIDs, err := s.store.AppointmentIDsForMedia(ctx, mediaID)
	if err != nil {
		return false, apperr.Internal(err)
	}
	for _, id := range appointmentIDs {
		if _, err := s.Get(ctx, id, userID); err == nil {
			return true, nil
		} else if ae, ok := apperr.As(err); ok && ae.HTTPStatus >= 500 {
			return false, err
		}
	}
	return false, nil
}
