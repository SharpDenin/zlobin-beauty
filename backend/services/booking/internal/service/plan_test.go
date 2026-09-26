package service

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestAssembleVisitPlansPrefersZeroWaitAndEarlierStart(t *testing.T) {
	day := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	mA := uuid.Must(uuid.NewV7())
	mB := uuid.Must(uuid.NewV7())
	svcA := PlanService{
		ID: uuid.Must(uuid.NewV7()), Name: "Стрижка", DurationMinutes: 40, PriceMinor: 100,
		Masters: []PlanCandidate{{MasterID: uuid.Must(uuid.NewV7()), MasterUserID: mA, MasterDisplayName: "Анна"}},
	}
	svcB := PlanService{
		ID: uuid.Must(uuid.NewV7()), Name: "Окрашивание", DurationMinutes: 90, PriceMinor: 200,
		Masters: []PlanCandidate{{MasterID: uuid.Must(uuid.NewV7()), MasterUserID: mB, MasterDisplayName: "Ольга"}},
	}
	kA := slotKey{Master: mA, Day: slotDayKey(day), Dur: 40}
	kB := slotKey{Master: mB, Day: slotDayKey(day), Dur: 90}
	at := func(h, m int) time.Time { return time.Date(2026, 9, 1, h, m, 0, 0, time.UTC) }
	slots := map[slotKey][]Slot{
		kA: {{StartsAt: at(10, 0), EndsAt: at(10, 40)}, {StartsAt: at(11, 0), EndsAt: at(11, 40)}},
		kB: {{StartsAt: at(11, 30), EndsAt: at(13, 0)}, {StartsAt: at(10, 40), EndsAt: at(12, 10)}},
	}
	got := AssembleVisitPlans([]PlanService{svcA, svcB}, slots, []time.Time{day}, 6)
	if len(got) == 0 {
		t.Fatal("expected plans")
	}
	if got[0].WaitMinutes != 0 {
		t.Fatalf("best wait=%d want 0", got[0].WaitMinutes)
	}
	if !got[0].StartsAt.Equal(at(10, 0)) || !got[0].EndsAt.Equal(at(12, 10)) {
		t.Fatalf("best span %s–%s", got[0].StartsAt, got[0].EndsAt)
	}
	if PlanTotalPrice(got[0].Legs) != 300 {
		t.Fatalf("price=%d", PlanTotalPrice(got[0].Legs))
	}
}

func TestAssembleVisitPlansSameMasterSkipsOverlap(t *testing.T) {
	day := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	m := uuid.Must(uuid.NewV7())
	mid := uuid.Must(uuid.NewV7())
	svcA := PlanService{ID: uuid.Must(uuid.NewV7()), Name: "A", DurationMinutes: 60, Masters: []PlanCandidate{{MasterID: mid, MasterUserID: m}}}
	svcB := PlanService{ID: uuid.Must(uuid.NewV7()), Name: "B", DurationMinutes: 60, Masters: []PlanCandidate{{MasterID: mid, MasterUserID: m}}}
	at := func(h int) time.Time { return time.Date(2026, 9, 1, h, 0, 0, 0, time.UTC) }
	k60 := slotKey{Master: m, Day: slotDayKey(day), Dur: 60}
	slots := map[slotKey][]Slot{
		k60: {{StartsAt: at(10), EndsAt: at(11)}, {StartsAt: at(10), EndsAt: at(11)}, {StartsAt: at(11), EndsAt: at(12)}},
	}
	got := AssembleVisitPlans([]PlanService{svcA, svcB}, slots, []time.Time{day}, 6)
	if len(got) != 1 {
		t.Fatalf("len=%d want 1 (only 10 then 11)", len(got))
	}
	if !got[0].SameMaster || got[0].WaitMinutes != 0 {
		t.Fatalf("%+v", got[0])
	}
}

func TestAssembleVisitPlansBusyAndOutsideHoursYieldNothing(t *testing.T) {
	day := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	m := uuid.Must(uuid.NewV7())
	svcA := PlanService{ID: uuid.Must(uuid.NewV7()), DurationMinutes: 60, Masters: []PlanCandidate{{MasterUserID: m}}}
	svcB := PlanService{ID: uuid.Must(uuid.NewV7()), DurationMinutes: 60, Masters: []PlanCandidate{{MasterUserID: m}}}
	got := AssembleVisitPlans([]PlanService{svcA, svcB}, map[slotKey][]Slot{}, []time.Time{day}, 6)
	if len(got) != 0 {
		t.Fatalf("empty FreeSlots must not invent plans: %+v", got)
	}
}

func TestArrangeServicesRejectsUnknownID(t *testing.T) {
	a := PlanService{ID: uuid.Must(uuid.NewV7()), Name: "A"}
	b := PlanService{ID: uuid.Must(uuid.NewV7()), Name: "B"}
	got, err := arrangeServices([]PlanService{a, b}, []uuid.UUID{b.ID, a.ID})
	if err != nil {
		t.Fatal(err)
	}
	if got[0].ID != b.ID || got[1].ID != a.ID {
		t.Fatalf("order not applied: %+v", got)
	}
	if _, err := arrangeServices([]PlanService{a, b}, []uuid.UUID{a.ID, uuid.Must(uuid.NewV7())}); err == nil {
		t.Fatal("unknown service in order must fail")
	}
}

func TestAssembleVisitPlansDropsLongWait(t *testing.T) {
	day := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	mA := uuid.Must(uuid.NewV7())
	mB := uuid.Must(uuid.NewV7())
	svcA := PlanService{DurationMinutes: 40, Masters: []PlanCandidate{{MasterUserID: mA}}}
	svcB := PlanService{DurationMinutes: 40, Masters: []PlanCandidate{{MasterUserID: mB}}}
	at := func(h int) time.Time { return time.Date(2026, 9, 1, h, 0, 0, 0, time.UTC) }
	slots := map[slotKey][]Slot{
		{Master: mA, Day: slotDayKey(day), Dur: 40}: {{StartsAt: at(10), EndsAt: at(10).Add(40 * time.Minute)}},
		{Master: mB, Day: slotDayKey(day), Dur: 40}: {{StartsAt: at(14), EndsAt: at(14).Add(40 * time.Minute)}},
	}
	got := AssembleVisitPlans([]PlanService{svcA, svcB}, slots, []time.Time{day}, 6)
	if len(got) != 0 {
		t.Fatalf("wait > %d must be dropped", MaxWaitMinutes)
	}
}
