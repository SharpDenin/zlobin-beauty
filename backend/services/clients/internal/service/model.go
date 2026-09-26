package service

import (
	"context"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func (s *Service) GetModelPreferences(ctx context.Context, userID uuid.UUID) (*domain.ModelPreference, error) {
	p, err := s.store.GetModelPreference(ctx, userID)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if p == nil {
		return &domain.ModelPreference{UserID: userID, Categories: []string{}}, nil
	}
	return p, nil
}

type PatchModelPreferencesInput struct {
	Willing    *bool
	Notify     *bool
	Categories *[]string
	City       *string
	DateFrom   *string
	DateTo     *string
}

func (s *Service) PatchModelPreferences(ctx context.Context, userID uuid.UUID, in PatchModelPreferencesInput) (*domain.ModelPreference, error) {
	p, err := s.GetModelPreferences(ctx, userID)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	if p.CreatedAt.IsZero() {
		p.CreatedAt = now
	}
	p.UpdatedAt = now
	p.UserID = userID
	if in.Willing != nil {
		p.Willing = *in.Willing
	}
	if in.Notify != nil {
		p.Notify = *in.Notify
	}
	if in.Categories != nil {
		cats := make([]string, 0, len(*in.Categories))
		for _, c := range *in.Categories {
			c = strings.TrimSpace(c)
			if c != "" {
				cats = append(cats, c)
			}
		}
		p.Categories = cats
	}
	if in.City != nil {
		p.City = strings.TrimSpace(*in.City)
	}
	if in.DateFrom != nil {
		p.DateFrom = parseDatePtr(*in.DateFrom)
	}
	if in.DateTo != nil {
		p.DateTo = parseDatePtr(*in.DateTo)
	}
	if !p.Willing {
		p.Notify = false
	}
	if err := s.store.UpsertModelPreference(ctx, *p); err != nil {
		return nil, apperr.Internal(err)
	}
	return p, nil
}

func (s *Service) MatchingModelPreferences(ctx context.Context, category, city, date string) ([]domain.ModelPreference, error) {
	day, err := time.Parse("2006-01-02", date)
	if err != nil {
		return nil, apperr.Validation("date must be YYYY-MM-DD")
	}
	items, err := s.store.MatchModelPreferences(ctx, category, city, day)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	var out []domain.ModelPreference
	for _, p := range items {
		if !p.Notify || !p.Willing {
			continue
		}
		if len(p.Categories) == 0 {
			continue
		}
		catOK := false
		for _, c := range p.Categories {
			if categoryMatch(c, category) {
				catOK = true
				break
			}
		}
		if !catOK {
			continue
		}
		if strings.TrimSpace(p.City) != "" && normalize(p.City) != normalize(city) {
			continue
		}
		if p.DateFrom != nil && day.Before(dateOnly(*p.DateFrom)) {
			continue
		}
		if p.DateTo != nil && day.After(dateOnly(*p.DateTo)) {
			continue
		}
		out = append(out, p)
	}
	if out == nil {
		out = []domain.ModelPreference{}
	}
	return out, nil
}

func parseDatePtr(raw string) *time.Time {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	t, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return nil
	}
	u := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	return &u
}

func dateOnly(t time.Time) time.Time {
	u := t.UTC()
	return time.Date(u.Year(), u.Month(), u.Day(), 0, 0, 0, 0, time.UTC)
}

func normalize(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	prev := false
	for _, r := range s {
		if unicode.IsSpace(r) || r == '/' || r == ',' {
			if !prev {
				b.WriteByte(' ')
				prev = true
			}
			continue
		}
		b.WriteRune(r)
		prev = false
	}
	return strings.TrimSpace(b.String())
}

func categoryMatch(a, b string) bool {
	na, nb := normalize(a), normalize(b)
	if na == "" || nb == "" {
		return false
	}
	return na == nb || strings.Contains(na, nb) || strings.Contains(nb, na)
}
