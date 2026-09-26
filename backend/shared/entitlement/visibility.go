package entitlement

// FormulaFieldKeys are category_fields that belong to a color formula, not the service scheme.
var FormulaFieldKeys = []string{"formula", "dye", "shades", "proportions", "oxidizer"}

func CanOmitFormula(snap Snapshot) bool {
	return snap.IsPremium()
}

func CanViewOtherMasterDetails(snap Snapshot) bool {
	return snap.IsPremium()
}

// TechnicalView is the server-side disclosure decision for scheme/formula payloads.
type TechnicalView struct {
	RevealScheme  bool
	RevealFormula bool
}

// VisitTechnicalView evaluates skip_service_scheme, omit_formula and subscription independently.
//
// isOwner — assigned master of this visit (always sees own stored data).
// isClient — the client of this visit (existing client rules; omit_formula does not hide from them).
// skipScheme — skip_service_scheme was set at completion (do not disclose scheme to others).
// omitFormula — formula is withheld from other professionals.
// viewerPremium — effective paid/trial plan of the viewer.
func VisitTechnicalView(isOwner, isClient, skipScheme, omitFormula, viewerPremium bool) TechnicalView {
	if isOwner {
		return TechnicalView{RevealScheme: true, RevealFormula: true}
	}
	if isClient {
		return TechnicalView{RevealScheme: !skipScheme, RevealFormula: true}
	}
	if !viewerPremium {
		return TechnicalView{RevealScheme: false, RevealFormula: false}
	}
	return TechnicalView{RevealScheme: !skipScheme, RevealFormula: !omitFormula}
}

func IsFormulaFieldKey(key string) bool {
	for _, k := range FormulaFieldKeys {
		if k == key {
			return true
		}
	}
	return false
}
