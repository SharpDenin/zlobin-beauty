package service

import (
	"encoding/json"

	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

var allowedDashboardIDs = map[string]struct{}{
	"alerts": {}, "calendar": {}, "today": {}, "upcoming": {}, "pending": {},
	"messages": {}, "tasks": {}, "clients_today": {}, "orders": {}, "deliveries": {},
	"analytics": {}, "calendar_colors": {}, "important_messages": {},
}

var allowedDashboardTypes = map[string]struct{}{
	"calendar": {}, "upcoming": {}, "today": {}, "important_messages": {},
	"tasks": {}, "clients_today": {}, "orders": {}, "alerts": {}, "pending": {},
	"messages": {}, "deliveries": {}, "analytics": {},
}

var allowedDashboardSizes = map[string]struct{}{
	"2x2": {}, "4x2": {}, "4x3": {}, "8x3": {}, "8x6": {}, "12x2": {}, "12x4": {},
	"small": {}, "medium": {}, "large": {}, "full": {},
}

func defaultWidgets() []byte {
	return []byte(`[
	  {"id":"alerts","enabled":true,"positions":{"lg":{"x":0,"y":0,"w":12,"h":5}}},
	  {"id":"calendar","enabled":true,"positions":{"lg":{"x":0,"y":5,"w":12,"h":18}}},
	  {"id":"today","enabled":true,"positions":{"lg":{"x":0,"y":23,"w":3,"h":4}}},
	  {"id":"pending","enabled":true,"positions":{"lg":{"x":3,"y":23,"w":3,"h":4}}},
	  {"id":"clients_today","enabled":true,"positions":{"lg":{"x":6,"y":23,"w":3,"h":4}}},
	  {"id":"upcoming","enabled":true,"positions":{"lg":{"x":0,"y":27,"w":6,"h":8}}},
	  {"id":"analytics","enabled":true,"positions":{"lg":{"x":6,"y":27,"w":6,"h":8}}}
	]`)
}

func ValidateDashboardWidgets(raw []byte) error {
	if !json.Valid(raw) {
		return apperr.Validation("widgets must be valid JSON")
	}
	var parsed []map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return apperr.Validation("widgets must be an array")
	}
	for _, w := range parsed {
		id, _ := w["id"].(string)
		typ, _ := w["type"].(string)
		if id == "calendar_colors" {
			continue
		}
		if id == "" && typ == "" {
			return apperr.Validation("widget id is required")
		}
		if id != "" {
			if _, ok := allowedDashboardIDs[id]; !ok {
				return apperr.Validation("unsupported widget")
			}
		}
		if typ != "" {
			if _, ok := allowedDashboardTypes[typ]; !ok {
				return apperr.Validation("unsupported widget type")
			}
		}
		if size, ok := w["size"].(string); ok && size != "" {
			if _, ok := allowedDashboardSizes[size]; !ok {
				return apperr.Validation("unsupported widget size")
			}
		}
	}
	return nil
}
