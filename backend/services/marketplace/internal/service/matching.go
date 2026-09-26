package service

import (
	"strings"
	"time"
	"unicode"
)

func normalizeMatch(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	prevSpace := false
	for _, r := range s {
		if unicode.IsSpace(r) || r == '/' || r == ',' || r == ';' || r == '-' {
			if !prevSpace {
				b.WriteByte(' ')
				prevSpace = true
			}
			continue
		}
		b.WriteRune(r)
		prevSpace = false
	}
	return strings.TrimSpace(b.String())
}

func CategoryMatch(a, b string) bool {
	return categoryScore(a, b) > 0
}

func categoryScore(a, b string) int {
	na, nb := normalizeMatch(a), normalizeMatch(b)
	if na == "" || nb == "" {
		return 0
	}
	if na == nb {
		return 3
	}
	if strings.Contains(na, nb) || strings.Contains(nb, na) {
		return 2
	}
	for _, tok := range strings.Fields(na) {
		if len([]rune(tok)) < 4 {
			continue
		}
		if strings.Contains(nb, tok) {
			return 1
		}
	}
	return 0
}

func CityMatch(a, b string) bool {
	na, nb := normalizeMatch(a), normalizeMatch(b)
	return na != "" && na == nb
}

func DateOverlap(eventStart, eventEnd, from, to time.Time) bool {
	es, ee := eventStart.UTC(), eventEnd.UTC()
	// Inclusive calendar-day windows from DATE columns are midnight UTC.
	if !ee.After(from) && !ee.Equal(from) {
		return false
	}
	if es.After(to.Add(24*time.Hour - time.Nanosecond)) {
		return false
	}
	day := time.Date(es.Year(), es.Month(), es.Day(), 0, 0, 0, 0, time.UTC)
	fromDay := time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, time.UTC)
	toDay := time.Date(to.Year(), to.Month(), to.Day(), 0, 0, 0, 0, time.UTC)
	return !day.Before(fromDay) && !day.After(toDay)
}

// MatchScore is deterministic: category + city + required date overlap.
// Returns 0 when the pair is not relevant.
func MatchScore(categoryA, categoryB, cityA, cityB string, eventStart, eventEnd, from, to time.Time) int {
	cs := categoryScore(categoryA, categoryB)
	if cs == 0 {
		return 0
	}
	if !CityMatch(cityA, cityB) {
		return 0
	}
	if !DateOverlap(eventStart, eventEnd, from, to) {
		return 0
	}
	score := cs + 2
	return score
}
