package domain

import (
	"strings"

	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

// ProcedureKind is a coarse, expandable classification used only for visit order.
// It is derived from existing service category/name — not a parallel catalog.
type ProcedureKind string

const (
	KindHaircut   ProcedureKind = "haircut"
	KindColoring  ProcedureKind = "coloring"
	KindTreatment ProcedureKind = "treatment"
	KindRemoval   ProcedureKind = "removal"
	KindCoating   ProcedureKind = "coating"
	KindStyling   ProcedureKind = "styling"
	KindOther     ProcedureKind = "other"
)

// OrderConstraint says Before must appear earlier than After in a visit.
type OrderConstraint struct {
	Before ProcedureKind
	After  ProcedureKind
	Reason string
}

// DefaultOrderConstraints is the minimal confirmed ruleset.
// Extend this table — do not special-case service names in planners.
var DefaultOrderConstraints = []OrderConstraint{
	{KindHaircut, KindColoring, "сначала стрижка, затем окрашивание"},
	{KindColoring, KindTreatment, "уход делают после окрашивания"},
	{KindRemoval, KindCoating, "снятие покрытия до нового покрытия"},
	{KindHaircut, KindStyling, "укладка после стрижки"},
}

func KindFromService(category, name string) ProcedureKind {
	blob := strings.ToLower(strings.TrimSpace(category) + " " + strings.TrimSpace(name))
	switch {
	case strings.Contains(blob, "снят"):
		return KindRemoval
	case strings.Contains(blob, "стриж") || strings.Contains(blob, "барбер") || strings.Contains(blob, "бород"):
		return KindHaircut
	case strings.Contains(blob, "колор") || strings.Contains(blob, "окраш") || strings.Contains(blob, "тонир"):
		return KindColoring
	case strings.Contains(blob, "уход"):
		return KindTreatment
	case strings.Contains(blob, "уклад"):
		return KindStyling
	case strings.Contains(blob, "маникюр") || strings.Contains(blob, "педикюр") || strings.Contains(blob, "дизайн ногт") || strings.Contains(blob, "покрыт"):
		return KindCoating
	default:
		return KindOther
	}
}

func RecommendedOrder(kinds []ProcedureKind) []int {
	n := len(kinds)
	index := make([]int, n)
	for i := range index {
		index[i] = i
	}
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			a, b := index[i], index[j]
			if orderRank(kinds[a], kinds[b]) > 0 {
				index[i], index[j] = index[j], index[i]
			}
		}
	}
	return index
}

func orderRank(left, right ProcedureKind) int {
	for _, c := range DefaultOrderConstraints {
		if left == c.After && right == c.Before {
			return 1
		}
		if left == c.Before && right == c.After {
			return -1
		}
	}
	return 0
}

func ValidateProcedureOrder(kinds []ProcedureKind) error {
	for i := 0; i < len(kinds); i++ {
		for j := i + 1; j < len(kinds); j++ {
			for _, c := range DefaultOrderConstraints {
				if kinds[i] == c.After && kinds[j] == c.Before {
					return apperr.ConflictCode(apperr.CodeProcedureOrderInvalid, c.Reason)
				}
			}
		}
	}
	return nil
}

func ConstraintReason(before, after ProcedureKind) string {
	for _, c := range DefaultOrderConstraints {
		if c.Before == before && c.After == after {
			return c.Reason
		}
	}
	return ""
}
