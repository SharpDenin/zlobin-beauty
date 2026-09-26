package httpapi

import (
	"bytes"
	"encoding/json"

	"github.com/google/uuid"
)

type photoMediaPatch struct {
	PhotoMediaID *uuid.UUID
	ClearPhoto   bool
}

// applyPhotoMediaField interprets PATCH photo_media_id.
//
//	omitted / empty raw → leave unchanged
//	null or ""          → clear (photo_media_id = NULL)
//	UUID string         → set
func applyPhotoMediaField(raw json.RawMessage) (photoMediaPatch, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return photoMediaPatch{}, nil
	}
	if bytes.Equal(raw, []byte("null")) {
		return photoMediaPatch{ClearPhoto: true}, nil
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return photoMediaPatch{}, err
	}
	if s == "" {
		return photoMediaPatch{ClearPhoto: true}, nil
	}
	id, err := uuid.Parse(s)
	if err != nil {
		return photoMediaPatch{}, err
	}
	return photoMediaPatch{PhotoMediaID: &id}, nil
}
