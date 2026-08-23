package domain

import "strings"

const (
	SchemeCategoryColoring = "coloring"
	SchemeCategoryHaircut  = "haircut"
	SchemeCategoryCare     = "care"
	SchemeCategoryGeneric  = "generic"
)

type SchemeFieldDef struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Type     string `json:"type"`
	Required bool   `json:"required"`
}

type SchemeTemplate struct {
	ID          string           `json:"id"`
	CategoryKey string           `json:"category_key"`
	Version     int              `json:"version"`
	Name        string           `json:"name"`
	Fields      []SchemeFieldDef `json:"fields"`
	Active      bool             `json:"active"`
}

// ResolveSchemeCategory maps a service name to a template category key.
func ResolveSchemeCategory(serviceName string) string {
	name := strings.ToLower(strings.TrimSpace(serviceName))
	switch {
	case strings.Contains(name, "окраш"), strings.Contains(name, "колор"), strings.Contains(name, "тонир"), strings.Contains(name, "мелир"):
		return SchemeCategoryColoring
	case strings.Contains(name, "стриж"):
		return SchemeCategoryHaircut
	case strings.Contains(name, "уход"), strings.Contains(name, "маск"), strings.Contains(name, "ламин"):
		return SchemeCategoryCare
	default:
		return SchemeCategoryGeneric
	}
}
