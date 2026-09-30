package service

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

const (
	maxPreferenceValueBytes = 16 << 10
	maxPreferencesPerUser   = 100
)

var preferenceKeyRe = regexp.MustCompile(`^[a-z][a-z0-9_-]*(\.[A-Za-z0-9_-]+){0,4}$`)

// Only UI namespaces may be stored here; business data never belongs in preferences.
var preferenceNamespaces = []string{"calendar.", "nav.", "ui.", "dashboard.", "messenger.", "forms."}

// Preference is the API shape of one stored preference.
type Preference struct {
	Key       string          `json:"key"`
	Value     json.RawMessage `json:"value"`
	UpdatedAt time.Time       `json:"updated_at"`
}

// ValidatePreferenceKey enforces the key grammar and namespace whitelist.
func ValidatePreferenceKey(key string) error {
	key = strings.TrimSpace(key)
	if len(key) == 0 || len(key) > 64 || !preferenceKeyRe.MatchString(key) {
		return apperr.Validation("invalid preference key")
	}
	for _, ns := range preferenceNamespaces {
		if strings.HasPrefix(key, ns) {
			return nil
		}
	}
	return apperr.Validation("unsupported preference namespace")
}

// ValidatePreferenceValue requires a bounded, valid JSON document.
func ValidatePreferenceValue(raw []byte) error {
	if len(raw) == 0 || len(raw) > maxPreferenceValueBytes {
		return apperr.Validation("preference value is empty or too large")
	}
	if !json.Valid(raw) {
		return apperr.Validation("preference value must be valid JSON")
	}
	if strings.TrimSpace(string(raw)) == "null" {
		return apperr.Validation("preference value must not be null")
	}
	return nil
}

func (s *Service) ListPreferences(ctx context.Context, userID uuid.UUID) ([]Preference, error) {
	rows, err := s.store.ListPreferences(ctx, userID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	out := make([]Preference, 0, len(rows))
	for _, r := range rows {
		out = append(out, Preference{Key: r.Key, Value: r.Value, UpdatedAt: r.UpdatedAt})
	}
	return out, nil
}

func (s *Service) SetPreference(ctx context.Context, userID uuid.UUID, key string, value []byte) (*Preference, error) {
	key = strings.TrimSpace(key)
	if err := ValidatePreferenceKey(key); err != nil {
		return nil, err
	}
	if err := ValidatePreferenceValue(value); err != nil {
		return nil, err
	}
	exists, err := s.store.PreferenceExists(ctx, userID, key)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if !exists {
		n, err := s.store.CountPreferences(ctx, userID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if n >= maxPreferencesPerUser {
			return nil, apperr.Validation("too many preferences")
		}
	}
	now := s.now().UTC()
	if err := s.store.UpsertPreference(ctx, userID, key, value, now); err != nil {
		return nil, apperr.Internal(err)
	}
	return &Preference{Key: key, Value: value, UpdatedAt: now}, nil
}

func (s *Service) DeletePreference(ctx context.Context, userID uuid.UUID, key string) error {
	key = strings.TrimSpace(key)
	if err := ValidatePreferenceKey(key); err != nil {
		return err
	}
	if err := s.store.DeletePreference(ctx, userID, key); err != nil {
		return apperr.Internal(err)
	}
	return nil
}
