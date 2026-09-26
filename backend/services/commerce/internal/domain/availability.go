package domain

import (
	"time"

	"github.com/google/uuid"
)

const (
	AvailabilityAvailable   = "available"
	AvailabilityIncoming    = "incoming"
	AvailabilityShortage    = "shortage"
	AvailabilityUnavailable = "unavailable"
	AvailabilityOrderable   = "orderable"
)

const NoStoredAlternativeReason = "Нет сохранённой альтернативы"

type QtyLine struct {
	ProductID uuid.UUID
	Qty       float64
}

type FamilyAlternative struct {
	ProductID   uuid.UUID
	ProductName string
}

type AvailabilityAlternative struct {
	Available   bool
	Reason      string
	ProductID   uuid.UUID
	ProductName string
}

type AvailabilityAnalysis struct {
	ServiceID     uuid.UUID
	CanPerformNow bool
	Status        string
	Items         []RequirementCheck
	Alternative   AvailabilityAlternative
}

// RequirementCheck is one material line for availability / repeat preview.
type RequirementCheck struct {
	ProductID    uuid.UUID
	Name         string
	Brand        string
	Unit         string
	RequiredQty  float64
	OnHand       float64
	Reserved     float64
	AvailableQty float64
	IncomingQty  float64
	ShortageQty  float64
	Status       string
	Orderable    bool
	ExpectedAt   *time.Time
}

// EvaluateRequirement compares current master available stock (on_hand − reserved)
// against required qty and expected incoming. Incoming is never treated as stock.
func EvaluateRequirement(required, onHand, reserved, incoming float64) (available, shortage float64, status string) {
	available = onHand - reserved
	if available < 0 {
		available = 0
	}
	if incoming < 0 {
		incoming = 0
	}
	if required < 1e-9 {
		return available, 0, AvailabilityAvailable
	}
	if available+1e-9 >= required {
		return available, 0, AvailabilityAvailable
	}
	gap := required - available
	covered := available + incoming
	if covered+1e-9 >= required {
		return available, 0, AvailabilityIncoming
	}
	shortage = required - covered
	if available+incoming <= 1e-9 {
		return available, shortage, AvailabilityUnavailable
	}
	_ = gap
	return available, shortage, AvailabilityShortage
}

func WorstAvailability(statuses []string) string {
	rank := map[string]int{
		AvailabilityAvailable:   0,
		AvailabilityIncoming:    1,
		AvailabilityOrderable:   2,
		AvailabilityShortage:    3,
		AvailabilityUnavailable: 4,
	}
	worst := AvailabilityAvailable
	bestRank := 0
	for _, st := range statuses {
		if rank[st] > bestRank {
			bestRank = rank[st]
			worst = st
		}
	}
	return worst
}

func CanRepeatFromStatuses(statuses []string) bool {
	if len(statuses) == 0 {
		return true
	}
	for _, st := range statuses {
		if st != AvailabilityAvailable {
			return false
		}
	}
	return true
}

func AggregateRequirements(items []QtyLine) map[uuid.UUID]float64 {
	out := map[uuid.UUID]float64{}
	for _, it := range items {
		if it.ProductID == uuid.Nil || it.Qty <= 1e-9 {
			continue
		}
		out[it.ProductID] += it.Qty
	}
	return out
}

func RemainingRequired(required, alreadyConsumed float64) float64 {
	left := required - alreadyConsumed
	if left < 1e-9 {
		return 0
	}
	return left
}

// CatalogOrderable is true when the product can be bought through the existing
// supplier catalog/order flow. Salon-owned rows are not supplier catalog.
func CatalogOrderable(p Product, buyerOrgID uuid.UUID) bool {
	if p.ID == uuid.Nil || p.ArchivedAt != nil {
		return false
	}
	if buyerOrgID != uuid.Nil && p.OrganizationID == buyerOrgID {
		return false
	}
	return ProductEligibleForOrder(p.Published, p.ForSale, p.OrganizationID, p.OrganizationID)
}

// ApplyOrderability keeps incoming/available as stock statuses. Shortage or
// unavailable becomes orderable only when the catalog can supply the product.
func ApplyOrderability(status string, catalogOrderable bool) (finalStatus string, orderable bool) {
	orderable = catalogOrderable
	if !catalogOrderable {
		return status, false
	}
	if status == AvailabilityShortage || status == AvailabilityUnavailable {
		return AvailabilityOrderable, true
	}
	return status, true
}

func FamilyRoot(p Product) uuid.UUID {
	if p.ParentID != nil && *p.ParentID != uuid.Nil {
		return *p.ParentID
	}
	return p.ID
}

// PickStoredFamilyAlternative uses catalog parent_id siblings already in master
// stock. It does not invent chemistry or formulas.
func PickStoredFamilyAlternative(missing uuid.UUID, needed float64, family []Product, availableByProduct map[uuid.UUID]float64) *FamilyAlternative {
	if missing == uuid.Nil || needed <= 1e-9 {
		return nil
	}
	var root uuid.UUID
	found := false
	for _, p := range family {
		if p.ID == missing {
			root = FamilyRoot(p)
			found = true
			break
		}
	}
	if !found || root == uuid.Nil {
		return nil
	}
	for _, p := range family {
		if p.ID == missing || p.ArchivedAt != nil {
			continue
		}
		if FamilyRoot(p) != root {
			continue
		}
		if availableByProduct[p.ID]+1e-9 >= needed {
			return &FamilyAlternative{ProductID: p.ID, ProductName: p.Name}
		}
	}
	return nil
}
