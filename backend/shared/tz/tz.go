package tz

import (
	"fmt"
	"strings"
	"time"
)

// Default is the last-resort IANA zone when city and explicit timezone are unknown.
// Prefer TimezoneForCity / Resolve / ResolveForBranch over this constant at call sites.
const Default = "Europe/Moscow"

// ErrTimezoneRequired is returned when a branch city is not in the map and no
// explicit IANA timezone was provided (avoids silent Europe/Moscow assignment).
var ErrTimezoneRequired = fmt.Errorf("timezone is required for city without a known IANA mapping")

// cityTimezones maps normalized Russian city names to IANA zones.
// Keep in sync with booking geo_cities seed and frontend timezoneForCity.
var cityTimezones = map[string]string{
	"красноярск":   "Asia/Krasnoyarsk",
	"новосибирск":  "Asia/Novosibirsk",
	"москва":       "Europe/Moscow",
	"санкт-петербург": "Europe/Moscow",
	"петербург":    "Europe/Moscow",
	"спб":          "Europe/Moscow",
}

// NormalizeCity lowercases and trims for map lookup.
func NormalizeCity(city string) string {
	return strings.ToLower(strings.TrimSpace(city))
}

// TimezoneForCity returns an IANA zone for a known city, or empty if unknown.
func TimezoneForCity(city string) string {
	if tz, ok := cityTimezones[NormalizeCity(city)]; ok {
		return tz
	}
	return ""
}

// KnownCity reports whether city has a built-in IANA mapping.
func KnownCity(city string) bool {
	return TimezoneForCity(city) != ""
}

// ResolveForBranch picks a timezone for creating/updating a branch.
// Explicit valid IANA always wins. Known cities may omit timezone.
// Unknown cities without an explicit timezone return ErrTimezoneRequired —
// never silently assign Default.
func ResolveForBranch(explicit, city string) (string, error) {
	explicit = strings.TrimSpace(explicit)
	if explicit != "" {
		if !Valid(explicit) {
			return "", fmt.Errorf("invalid timezone")
		}
		return explicit, nil
	}
	if fromCity := TimezoneForCity(city); fromCity != "" {
		return fromCity, nil
	}
	return "", ErrTimezoneRequired
}

// Valid reports whether name is a loadable IANA timezone.
func Valid(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return false
	}
	_, err := time.LoadLocation(name)
	return err == nil
}

// Resolve picks an IANA timezone:
// 1) explicit valid timezone
// 2) city map
// 3) Default
// Invalid explicit values fall through to city/default (callers that must reject
// invalid input should check Valid first).
func Resolve(explicit, city string) string {
	tz := strings.TrimSpace(explicit)
	if Valid(tz) {
		return tz
	}
	if fromCity := TimezoneForCity(city); fromCity != "" {
		return fromCity
	}
	return Default
}

// MustLoad is like time.LoadLocation but falls back to UTC on error (tests/tools).
func MustLoad(name string) *time.Location {
	loc, err := time.LoadLocation(strings.TrimSpace(name))
	if err != nil {
		return time.UTC
	}
	return loc
}
