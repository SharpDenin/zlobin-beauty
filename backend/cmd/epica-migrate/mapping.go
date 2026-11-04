package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/google/uuid"
)

func loadMapping(path string) (*Mapping, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("mapping file is required (--mapping)")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var m Mapping
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("parse mapping: %w", err)
	}
	if m.Users == nil {
		m.Users = map[string]string{}
	}
	if m.Organizations == nil {
		m.Organizations = map[string]string{}
	}
	return &m, nil
}

func (m *Mapping) remapUser(src uuid.UUID, allowPassthrough bool) (uuid.UUID, error) {
	dst, ok := m.Users[src.String()]
	if !ok || strings.TrimSpace(dst) == "" {
		return uuid.Nil, fmt.Errorf("no user mapping for %s", src)
	}
	id, err := uuid.Parse(dst)
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid mapped user id %q: %w", dst, err)
	}
	if id == src && !allowPassthrough {
		return uuid.Nil, fmt.Errorf("user mapping for %s points to the same local id — refuse to reuse demo identity in production", src)
	}
	return id, nil
}

func (m *Mapping) remapOrg(src *uuid.UUID, allowPassthrough bool) (*uuid.UUID, error) {
	if src == nil {
		return nil, nil
	}
	dst, ok := m.Organizations[src.String()]
	if !ok || strings.TrimSpace(dst) == "" {
		return nil, fmt.Errorf("no organization mapping for %s", src)
	}
	id, err := uuid.Parse(dst)
	if err != nil {
		return nil, fmt.Errorf("invalid mapped org id %q: %w", dst, err)
	}
	if id == *src && !allowPassthrough {
		return nil, fmt.Errorf("organization mapping for %s points to the same local id — refuse to reuse demo org in production", src)
	}
	return &id, nil
}

func writeExampleMapping(path string, userID, orgID string) error {
	ex := Mapping{
		Users: map[string]string{
			userID: "REPLACE_WITH_PRODUCTION_SUPPLIER_USER_UUID",
		},
		Organizations: map[string]string{
			orgID: "REPLACE_WITH_PRODUCTION_SUPPLIER_ORG_UUID",
		},
	}
	raw, err := json.MarshalIndent(ex, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o600)
}
