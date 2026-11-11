package main

import (
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// MasterOwnerRow is one marketplace master_profiles projection used for sync.
type MasterOwnerRow struct {
	ProfileID   uuid.UUID
	UserID      uuid.UUID
	OwnerStatus string
	Published   bool
}

// IdentityStatus is the Identity source-of-truth status for a user id.
type IdentityStatus struct {
	UserID uuid.UUID
	Status string
}

// Change is a planned owner_status update (and optional unpublish for deleted).
type Change struct {
	ProfileID   uuid.UUID
	UserID      uuid.UUID
	FromStatus  string
	ToStatus    string
	Published   bool
	ForceUnpub  bool // true when ToStatus=deleted and Published is currently true
	Reason      string
}

// PlanResult summarizes a dry-run or apply plan.
type PlanResult struct {
	Scanned   int
	Unchanged int
	Changes   []Change
	Missing   []uuid.UUID
	Unknown   []IdentityStatus
	Errors    []string
}

func normalizeIdentityStatus(raw string) (string, error) {
	s := strings.TrimSpace(strings.ToLower(raw))
	switch s {
	case "active", "blocked", "deleted":
		return s, nil
	default:
		return "", fmt.Errorf("unknown identity status %q", raw)
	}
}

// BuildPlan maps marketplace rows to Identity statuses.
// Missing Identity users and unknown statuses are hard errors for apply (fail closed).
func BuildPlan(rows []MasterOwnerRow, byUser map[uuid.UUID]string) PlanResult {
	out := PlanResult{}
	seenUser := map[uuid.UUID]struct{}{}
	for _, row := range rows {
		out.Scanned++
		if row.UserID == uuid.Nil {
			out.Errors = append(out.Errors, fmt.Sprintf("profile %s has nil user_id", row.ProfileID))
			continue
		}
		raw, ok := byUser[row.UserID]
		if !ok {
			if _, dup := seenUser[row.UserID]; !dup {
				out.Missing = append(out.Missing, row.UserID)
				seenUser[row.UserID] = struct{}{}
			}
			continue
		}
		to, err := normalizeIdentityStatus(raw)
		if err != nil {
			out.Unknown = append(out.Unknown, IdentityStatus{UserID: row.UserID, Status: raw})
			out.Errors = append(out.Errors, fmt.Sprintf("user %s: %v", row.UserID, err))
			continue
		}
		from := strings.TrimSpace(strings.ToLower(row.OwnerStatus))
		if from == "" {
			from = "active"
		}
		forceUnpub := to == "deleted" && row.Published
		if from == to && !forceUnpub {
			out.Unchanged++
			continue
		}
		reason := "status mismatch"
		if from == to && forceUnpub {
			reason = "deleted still published"
		}
		out.Changes = append(out.Changes, Change{
			ProfileID:  row.ProfileID,
			UserID:     row.UserID,
			FromStatus: from,
			ToStatus:   to,
			Published:  row.Published,
			ForceUnpub: forceUnpub,
			Reason:     reason,
		})
	}
	return out
}

// PlanBlocksApply reports whether apply must abort (missing/unknown/errors).
func PlanBlocksApply(p PlanResult) error {
	if len(p.Errors) > 0 || len(p.Missing) > 0 || len(p.Unknown) > 0 {
		return fmt.Errorf("plan has %d errors, %d missing identity users, %d unknown statuses — refuse apply",
			len(p.Errors), len(p.Missing), len(p.Unknown))
	}
	return nil
}
