package adminaudit

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

var httpClient = &http.Client{Timeout: 3 * time.Second}

func Record(ctx context.Context, identityURL, internalToken string, actor uuid.UUID, action, entityType string, entityID *uuid.UUID, meta map[string]any) {
	identityURL = strings.TrimRight(strings.TrimSpace(identityURL), "/")
	if identityURL == "" || strings.TrimSpace(internalToken) == "" {
		return
	}
	if meta == nil {
		meta = map[string]any{}
	}
	body, err := json.Marshal(map[string]any{
		"actor_user_id": actor.String(),
		"action":        action,
		"entity_type":   entityType,
		"entity_id":     uuidString(entityID),
		"meta":          meta,
	})
	if err != nil {
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, identityURL+"/v1/internal/audit", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", internalToken)
	resp, err := httpClient.Do(req)
	if err != nil {
		return
	}
	_ = resp.Body.Close()
}

func uuidString(id *uuid.UUID) any {
	if id == nil {
		return nil
	}
	return id.String()
}
