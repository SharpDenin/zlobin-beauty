package service

import (
	"testing"
	"time"
)

func TestCategoryMatchColoring(t *testing.T) {
	if !CategoryMatch("Колористика / сложное окрашивание", "Колористика") {
		t.Fatal("expected colorist topics to match")
	}
	if CategoryMatch("Маникюр", "Колористика") {
		t.Fatal("unrelated topics must not match")
	}
}

func TestMatchScoreDemo(t *testing.T) {
	start := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	end := time.Date(2026, 9, 15, 14, 0, 0, 0, time.UTC)
	from := time.Date(2026, 9, 15, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 9, 15, 0, 0, 0, 0, time.UTC)
	score := MatchScore("Колористика / сложное окрашивание", "Колористика", "Красноярск", "Красноярск", start, end, from, to)
	if score == 0 {
		t.Fatal("demo pair must be relevant")
	}
	if MatchScore("Колористика", "Колористика", "Москва", "Красноярск", start, end, from, to) != 0 {
		t.Fatal("different cities must not match")
	}
	other := time.Date(2026, 9, 16, 0, 0, 0, 0, time.UTC)
	if MatchScore("Колористика", "Колористика", "Красноярск", "Красноярск", start, end, other, other) != 0 {
		t.Fatal("non-overlapping dates must not match")
	}
}
