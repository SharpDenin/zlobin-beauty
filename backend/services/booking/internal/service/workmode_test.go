package service

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestCoveringWorkModeAdjacentAndOverlap(t *testing.T) {
	base := time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC)
	at := func(h, m int) time.Time { return base.Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute) }
	chair := domain.WorkModeInterval{Mode: domain.WorkModeChair, StartsAt: at(10, 0), EndsAt: at(14, 0)}
	onsite := domain.WorkModeInterval{Mode: domain.WorkModeOnsite, StartsAt: at(15, 0), EndsAt: at(20, 0)}
	items := []domain.WorkModeInterval{chair, onsite}

	if got := coveringWorkMode(items, at(11, 0), at(12, 0)); got == nil || got.Mode != domain.WorkModeChair {
		t.Fatalf("11:00 should be chair, got %#v", got)
	}
	if got := coveringWorkMode(items, at(17, 0), at(18, 0)); got == nil || got.Mode != domain.WorkModeOnsite {
		t.Fatalf("17:00 should be onsite, got %#v", got)
	}
	if got := coveringWorkMode(items, at(14, 30), at(15, 0)); got != nil {
		t.Fatalf("14:30 gap must not match a mode, got %#v", got)
	}
	if IntervalsOverlap(at(10, 0), at(14, 0), at(14, 0), at(18, 0)) {
		t.Fatal("back-to-back 10-14 and 14-18 must not overlap")
	}
	if !IntervalsOverlap(at(10, 0), at(14, 0), at(13, 0), at(18, 0)) {
		t.Fatal("10-14 and 13-18 must overlap")
	}
}

func TestDistrictInInterval(t *testing.T) {
	central := uuid.MustParse("11111111-1111-4111-8111-111111111011")
	other := uuid.MustParse("11111111-1111-4111-8111-111111111012")
	in := domain.WorkModeInterval{Districts: []domain.GeoDistrict{{ID: central, Name: "Центральный"}}}
	if !districtInInterval(in, central) {
		t.Fatal("expected central district to match")
	}
	if districtInInterval(in, other) {
		t.Fatal("oktyabrsky must not match central-only interval")
	}
}

func TestWorkModeLabel(t *testing.T) {
	if domain.WorkModeLabel(domain.WorkModePercentage) != "На процентах" {
		t.Fatal(domain.WorkModeLabel(domain.WorkModePercentage))
	}
	if domain.WorkModeLabel(domain.WorkModeChair) != "В салоне" {
		t.Fatal(domain.WorkModeLabel(domain.WorkModeChair))
	}
	if domain.WorkModeLabel(domain.WorkModeOnsite) != "Выезд" {
		t.Fatal(domain.WorkModeLabel(domain.WorkModeOnsite))
	}
}

func TestChairOwnSalonLeaseError(t *testing.T) {
	err := apperr.ValidationCode(apperr.CodeChairOwnSalonLease, "Сотрудник салона не может арендовать кресло в этом салоне.")
	ae, ok := apperr.As(err)
	if !ok {
		t.Fatal("expected apperr")
	}
	if ae.Code != apperr.CodeChairOwnSalonLease {
		t.Fatalf("code %s", ae.Code)
	}
	if ae.Message != "Сотрудник салона не может арендовать кресло в этом салоне." {
		t.Fatalf("message %s", ae.Message)
	}
}
