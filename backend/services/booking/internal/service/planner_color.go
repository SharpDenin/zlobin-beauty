package service

import (
	"regexp"
	"strings"

	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

// Allowed palette tokens for planner blocks (theme-aware on the client).
var plannerColorTokens = map[string]struct{}{
	"primary": {},
	"success": {},
	"warning": {},
	"danger":  {},
	"info":    {},
	"neutral": {},
	"violet":  {},
	"teal":    {},
	"rose":    {},
	"amber":   {},
}

var hexColorRe = regexp.MustCompile(`(?i)^#([0-9a-f]{6}|[0-9a-f]{8})$`)

// categoryDefaultColor maps planner categories to palette tokens.
func categoryDefaultColor(category string) string {
	switch strings.TrimSpace(strings.ToLower(category)) {
	case "break":
		return "info"
	case "blocked":
		return "danger"
	case "task":
		return "success"
	case "delivery", "salon_visit":
		return "teal"
	case "operational", "staff":
		return "warning"
	case "personal":
		return "neutral"
	default:
		return "primary"
	}
}

// NormalizePlannerColor accepts a palette token or legacy #RRGGBB[AA] hex.
// Empty input falls back to the category default (or primary).
func NormalizePlannerColor(color, category string) (string, error) {
	c := strings.TrimSpace(color)
	if c == "" {
		return categoryDefaultColor(category), nil
	}
	lower := strings.ToLower(c)
	if _, ok := plannerColorTokens[lower]; ok {
		return lower, nil
	}
	// CSS var leftovers from older clients — map to tokens.
	if strings.HasPrefix(lower, "var(--color-") {
		inner := strings.TrimSuffix(strings.TrimPrefix(lower, "var(--color-"), ")")
		inner = strings.TrimSuffix(inner, "-soft")
		inner = strings.TrimSuffix(inner, "-muted")
		if _, ok := plannerColorTokens[inner]; ok {
			return inner, nil
		}
		return categoryDefaultColor(category), nil
	}
	if hexColorRe.MatchString(c) {
		return strings.ToLower(c), nil
	}
	return "", apperr.Validation("invalid planner color")
}

func colorOrDefault(c string) string {
	normalized, err := NormalizePlannerColor(c, "")
	if err != nil || normalized == "" {
		return "primary"
	}
	return normalized
}
