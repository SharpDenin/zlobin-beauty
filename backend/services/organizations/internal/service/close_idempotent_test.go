package service

import (
	"encoding/json"
	"testing"

	"github.com/zlobin/zlobin-beauty/backend/services/organizations/internal/domain"
)

func TestBranchCloseJobStatuses(t *testing.T) {
	for _, st := range []string{
		domain.BranchCloseRunning,
		domain.BranchCloseCompleted,
		domain.BranchCloseFailed,
		domain.BranchCloseBlocked,
	} {
		if st == "" {
			t.Fatal("empty status")
		}
	}
}

func TestBranchCloseBlockerJSONRoundTrip(t *testing.T) {
	raw, err := json.Marshal([]domain.BranchCloseBlocker{{
		Code: "active_chair_leases", Label: "Активные аренды кресел", Count: 2, Href: "/salon/settings",
	}})
	if err != nil {
		t.Fatal(err)
	}
	var out []domain.BranchCloseBlocker
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 || out[0].Count != 2 {
		t.Fatalf("%+v", out)
	}
}
