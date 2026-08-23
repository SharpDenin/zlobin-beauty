package service

import "testing"

func TestNormalizeTaskKind(t *testing.T) {
	if got := NormalizeTaskKind("salon_visit"); got != "salon_visit" {
		t.Fatalf("kind=%s", got)
	}
	if got := NormalizeTaskKind("unknown"); got != "other" {
		t.Fatalf("kind=%s", got)
	}
}

func TestPlannerCategoryForKind(t *testing.T) {
	if got := PlannerCategoryForKind("salon_visit"); got != "salon_visit" {
		t.Fatalf("cat=%s", got)
	}
	if got := PlannerCategoryForKind("delivery_support"); got != "delivery" {
		t.Fatalf("cat=%s", got)
	}
	if got := PlannerCategoryForKind("payment_collection"); got != "task" {
		t.Fatalf("cat=%s", got)
	}
}
