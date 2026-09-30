package main

import (
	"fmt"
	"net/http"
	"time"
)

// seedCalendarTasks creates a few COLORED planner blocks relative to now.
// Idempotent: skips a title if an overlapping block with the same title already exists
// in the next 7 days. Lead wires this from main.go — do not call from elsewhere.
func seedCalendarTasks(c *http.Client, base string, master authUser) error {
	now := time.Now()
	loc := now.Location()
	type spec struct {
		title    string
		category string
		color    string
		dayOff   int
		hour     int
		mins     int
		durMin   int
	}
	specs := []spec{
		{title: "Задача: закупка расходников", category: "task", color: "success", dayOff: 0, hour: 9, mins: 0, durMin: 60},
		{title: "Перерыв / обед", category: "break", color: "info", dayOff: 0, hour: 13, mins: 0, durMin: 45},
		{title: "Личное: банк", category: "personal", color: "neutral", dayOff: 1, hour: 11, mins: 0, durMin: 30},
		{title: "Доставка косметики", category: "delivery", color: "teal", dayOff: 2, hour: 15, mins: 0, durMin: 60},
		{title: "Блок: обучение", category: "blocked", color: "danger", dayOff: 3, hour: 10, mins: 0, durMin: 90},
	}

	var existing struct {
		Items []struct {
			Title string `json:"title"`
		} `json:"items"`
	}
	from := now.Add(-12 * time.Hour).UTC().Format(time.RFC3339)
	to := now.Add(8 * 24 * time.Hour).UTC().Format(time.RFC3339)
	st, err := doJSON(c, http.MethodGet, base+"/v1/planner/blocks?from="+from+"&to="+to, master.Token, nil, &existing)
	if err != nil {
		return err
	}
	if st >= 300 {
		return fmt.Errorf("list planner blocks status %d", st)
	}
	have := map[string]bool{}
	for _, it := range existing.Items {
		have[it.Title] = true
	}

	for _, s := range specs {
		if have[s.title] {
			continue
		}
		day := time.Date(now.Year(), now.Month(), now.Day(), s.hour, s.mins, 0, 0, loc).AddDate(0, 0, s.dayOff)
		end := day.Add(time.Duration(s.durMin) * time.Minute)
		st, err := doJSON(c, http.MethodPost, base+"/v1/planner/blocks", master.Token, map[string]any{
			"title":     s.title,
			"category":  s.category,
			"color":     s.color,
			"starts_at": day.UTC().Format(time.RFC3339),
			"ends_at":   end.UTC().Format(time.RFC3339),
			"timezone":  "Asia/Krasnoyarsk",
		}, nil)
		if err != nil {
			return err
		}
		if st >= 300 && st != 409 {
			return fmt.Errorf("seed calendar task %q status %d", s.title, st)
		}
	}
	return nil
}
