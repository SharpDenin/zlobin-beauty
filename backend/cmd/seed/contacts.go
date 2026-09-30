package main

import (
	"fmt"
	"log"
	"net/http"
)

// seedContacts adds a few realistic contacts for owner against peers. Idempotent:
// existing contacts (HTTP 200) are treated as success.
func seedContacts(c *http.Client, base string, owner authUser, peers ...authUser) error {
	if owner.Token == "" {
		return fmt.Errorf("owner token missing")
	}
	notes := []string{
		"Клиент из адресной книги",
		"Коллега по салону",
		"Поставщик для заказов",
	}
	for i, peer := range peers {
		if peer.ID == "" || peer.ID == owner.ID {
			continue
		}
		note := notes[i%len(notes)]
		var out map[string]any
		st, err := doJSON(c, http.MethodPost, base+"/v1/contacts", owner.Token, map[string]any{
			"user_id": peer.ID, "note": note,
		}, &out)
		if err != nil {
			return fmt.Errorf("add contact %s: %w", peer.Email, err)
		}
		if st == http.StatusOK || st == http.StatusCreated {
			log.Printf("ok contact owner=%s peer=%s status=%d", owner.Email, peer.Email, st)
			continue
		}
		return fmt.Errorf("add contact %s status %d", peer.Email, st)
	}
	return nil
}
