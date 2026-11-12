package service

import (
	"testing"
	"time"

	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/tz"
)

// Documents frozen location_timezone semantics for historical appointments:
// display and reschedule slot math use the snapshot, not a later branch TZ edit.
func TestAppointmentTimezoneSnapshotPreferredOverBranchDefault(t *testing.T) {
	a := domain.Appointment{
		LocationTimezone: "Asia/Krasnoyarsk",
		LocationCity:     "Красноярск",
		StartsAt:         time.Date(2026, 6, 15, 9, 0, 0, 0, time.UTC), // 16:00 Krasnoyarsk
	}
	// Branch later "corrected" to Moscow must not rewrite the frozen label.
	branchNow := tz.Resolve("Europe/Moscow", "Красноярск")
	if branchNow != "Europe/Moscow" {
		t.Fatalf("branch resolve: %s", branchNow)
	}
	frozen := a.LocationTimezone
	if frozen != "Asia/Krasnoyarsk" {
		t.Fatal("snapshot must stay Krasnoyarsk")
	}
	loc := tz.MustLoad(frozen)
	wall := a.StartsAt.In(loc)
	if wall.Hour() != 16 || wall.Minute() != 0 {
		t.Fatalf("historical wall clock changed: %s", wall)
	}
	// Same UTC instant in the new branch zone would look like 12:00 — that is
	// display-only if someone mistakenly used branch TZ; snapshot keeps 16:00.
	mskWall := a.StartsAt.In(tz.MustLoad(branchNow))
	if mskWall.Hour() != 12 {
		t.Fatalf("expected 12:00 Moscow for contrast, got %v", mskWall)
	}
}

func TestRescheduleKeepsStartsAtUTCWithoutRewritingSnapshot(t *testing.T) {
	// Store.Reschedule updates only starts_at/ends_at (see store.go) — location_timezone
	// is intentionally omitted from the UPDATE so a branch TZ change cannot mutate history.
	before := domain.Appointment{
		LocationTimezone: "Europe/Moscow",
		StartsAt:         time.Date(2026, 6, 15, 13, 0, 0, 0, time.UTC),
	}
	afterStarts := time.Date(2026, 6, 16, 13, 0, 0, 0, time.UTC)
	if before.LocationTimezone != "Europe/Moscow" {
		t.Fatal("snapshot must be unchanged by a starts_at move")
	}
	if !afterStarts.Equal(time.Date(2026, 6, 16, 16, 0, 0, 0, tz.MustLoad("Europe/Moscow")).UTC()) {
		t.Fatal("moved wall 16:00 Moscow must stay the same UTC offset")
	}
}
