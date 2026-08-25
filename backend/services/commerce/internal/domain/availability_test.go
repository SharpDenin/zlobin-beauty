package domain

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestEvaluateRequirement(t *testing.T) {
	av, sh, st := EvaluateRequirement(30, 40, 0, 0)
	if st != AvailabilityAvailable || av < 39.9 || sh != 0 {
		t.Fatalf("available case av=%v sh=%v st=%s", av, sh, st)
	}
	av, sh, st = EvaluateRequirement(30, 10, 0, 0)
	if st != AvailabilityShortage || sh < 19.9 || sh > 20.1 {
		t.Fatalf("shortage 20 av=%v sh=%v st=%s", av, sh, st)
	}
	av, sh, st = EvaluateRequirement(30, 10, 0, 20)
	if st != AvailabilityIncoming || sh != 0 || av < 9.9 {
		t.Fatalf("covered by incoming av=%v sh=%v st=%s", av, sh, st)
	}
	av, sh, st = EvaluateRequirement(30, 10, 0, 5)
	if st != AvailabilityShortage || sh < 14.9 || sh > 15.1 {
		t.Fatalf("partial incoming shortage 15 av=%v sh=%v st=%s", av, sh, st)
	}
	_, _, st = EvaluateRequirement(30, 0, 0, 0)
	if st != AvailabilityUnavailable {
		t.Fatalf("unavailable st=%s", st)
	}
	av, _, st = EvaluateRequirement(30, 50, 20, 0)
	if st != AvailabilityAvailable || av < 29.9 {
		t.Fatalf("reserved reduces available av=%v st=%s", av, st)
	}
}

func TestCanRepeatAndWorst(t *testing.T) {
	if !CanRepeatFromStatuses([]string{AvailabilityAvailable, AvailabilityAvailable}) {
		t.Fatal("all available should allow repeat")
	}
	if CanRepeatFromStatuses([]string{AvailabilityAvailable, AvailabilityIncoming}) {
		t.Fatal("incoming is not current stock")
	}
	if WorstAvailability([]string{AvailabilityAvailable, AvailabilityShortage, AvailabilityIncoming}) != AvailabilityShortage {
		t.Fatal("worst should be shortage")
	}
	if WorstAvailability([]string{AvailabilityAvailable, AvailabilityOrderable, AvailabilityIncoming}) != AvailabilityOrderable {
		t.Fatal("orderable is worse than incoming")
	}
	if WorstAvailability([]string{AvailabilityOrderable, AvailabilityUnavailable}) != AvailabilityUnavailable {
		t.Fatal("unavailable is worse than orderable")
	}
}

func TestAggregateAndRemaining(t *testing.T) {
	pidA := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	pidB := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	got := AggregateRequirements([]QtyLine{
		{ProductID: pidA, Qty: 30},
		{ProductID: pidA, Qty: 10},
		{ProductID: pidB, Qty: 20},
		{ProductID: pidA, Qty: 0},
	})
	if got[pidA] < 39.9 || got[pidA] > 40.1 || got[pidB] < 19.9 {
		t.Fatalf("aggregate %+v", got)
	}
	if RemainingRequired(30, 10) < 19.9 || RemainingRequired(30, 10) > 20.1 {
		t.Fatal("remaining 20")
	}
	if RemainingRequired(30, 30) != 0 || RemainingRequired(10, 40) != 0 {
		t.Fatal("fully consumed remaining is 0")
	}
}

func TestApplyOrderability(t *testing.T) {
	st, ok := ApplyOrderability(AvailabilityShortage, true)
	if st != AvailabilityOrderable || !ok {
		t.Fatalf("shortage+catalog -> orderable got %s %v", st, ok)
	}
	st, ok = ApplyOrderability(AvailabilityUnavailable, true)
	if st != AvailabilityOrderable || !ok {
		t.Fatalf("unavailable+catalog -> orderable got %s %v", st, ok)
	}
	st, ok = ApplyOrderability(AvailabilityShortage, false)
	if st != AvailabilityShortage || ok {
		t.Fatalf("shortage without catalog stays shortage got %s %v", st, ok)
	}
	st, ok = ApplyOrderability(AvailabilityIncoming, true)
	if st != AvailabilityIncoming || !ok {
		t.Fatalf("incoming stays incoming even if catalog-orderable got %s %v", st, ok)
	}
	st, ok = ApplyOrderability(AvailabilityAvailable, true)
	if st != AvailabilityAvailable {
		t.Fatalf("available stays available got %s", st)
	}
}

func TestCatalogOrderable(t *testing.T) {
	buyer := uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	supplier := uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
	p := Product{ID: uuid.MustParse("33333333-3333-3333-3333-333333333333"), OrganizationID: supplier, Published: true, ForSale: true}
	if !CatalogOrderable(p, buyer) {
		t.Fatal("published for_sale supplier product should be orderable")
	}
	p.Published = false
	if CatalogOrderable(p, buyer) {
		t.Fatal("unpublished is not orderable")
	}
	p.Published, p.ForSale = true, false
	if CatalogOrderable(p, buyer) {
		t.Fatal("not for_sale is not orderable")
	}
	p.ForSale = true
	p.OrganizationID = buyer
	if CatalogOrderable(p, buyer) {
		t.Fatal("salon-owned product is not supplier catalog")
	}
	now := time.Now()
	p.OrganizationID = supplier
	p.ArchivedAt = &now
	if CatalogOrderable(p, buyer) {
		t.Fatal("archived is not orderable")
	}
}

func TestPickStoredFamilyAlternative(t *testing.T) {
	parent := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	missing := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	sibling := uuid.MustParse("66666666-6666-6666-6666-666666666666")
	family := []Product{
		{ID: missing, ParentID: &parent, Name: "Majirel 7.1"},
		{ID: sibling, ParentID: &parent, Name: "Majirel 7.0"},
		{ID: parent, Name: "Majirel line"},
	}
	got := PickStoredFamilyAlternative(missing, 30, family, map[uuid.UUID]float64{sibling: 40})
	if got == nil || got.ProductID != sibling {
		t.Fatalf("expected sibling alternative %+v", got)
	}
	if PickStoredFamilyAlternative(missing, 30, family, map[uuid.UUID]float64{sibling: 10}) != nil {
		t.Fatal("sibling without enough stock is not an alternative")
	}
	if PickStoredFamilyAlternative(missing, 30, family, map[uuid.UUID]float64{}) != nil {
		t.Fatal("no stored alternative")
	}
}
