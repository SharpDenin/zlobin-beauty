package main

import (
	"encoding/json"
	"log"
	"net/http"
)

// seedPortfolio uploads a handful of portfolio photos for a master (idempotent).
// Lead wires: seedPortfolio(c, base, users["master1"]).
func seedPortfolio(c *http.Client, base string, master authUser) error {
	var list struct {
		Items []json.RawMessage `json:"items"`
	}
	_, _ = doJSON(c, http.MethodGet, base+"/v1/me/master/portfolio", master.Token, nil, &list)
	if len(list.Items) > 0 {
		return nil
	}

	entries := []struct {
		rel      string
		title    string
		category string
	}{
		{"services/стрижка.jpg", "Мужская стрижка fade", "Стрижки"},
		{"services/окрашивание.jpg", "Сложное окрашивание", "Окрашивание"},
		{"services/укладка.jpg", "Вечерняя укладка", "Укладки"},
		{"services/мужская-стрижка.jpg", "Текстурная стрижка", "Стрижки"},
		{"services/маникюр.jpg", "Чистый маникюр", "Маникюр"},
		{"epica/538.jpg", "Блонд air-touch", "Окрашивание"},
	}

	for _, e := range entries {
		id := uploadSeedAssetIfExists(c, base, master.Token, "portfolio", e.rel)
		if id == "" {
			continue
		}
		status, err := doJSON(c, http.MethodPost, base+"/v1/me/master/portfolio", master.Token, map[string]any{
			"media_id": id,
			"title":    e.title,
			"caption":  e.title,
			"category": e.category,
		}, nil)
		if err != nil || status >= 300 {
			log.Printf("warn seedPortfolio %s status=%d err=%v", e.rel, status, err)
			continue
		}
	}
	return nil
}
