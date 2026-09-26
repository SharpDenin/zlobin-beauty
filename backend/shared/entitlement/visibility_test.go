package entitlement

import "testing"

func TestVisitTechnicalViewOwnerAlwaysSees(t *testing.T) {
	for _, skip := range []bool{false, true} {
		for _, omit := range []bool{false, true} {
			v := VisitTechnicalView(true, false, skip, omit, false)
			if !v.RevealScheme || !v.RevealFormula {
				t.Fatalf("owner skip=%v omit=%v: %+v", skip, omit, v)
			}
		}
	}
}

func TestVisitTechnicalViewFourCombinationsPaidPeer(t *testing.T) {
	cases := []struct {
		skip, omit, scheme, formula bool
	}{
		{false, false, true, true},
		{true, false, false, true},
		{false, true, true, false},
		{true, true, false, false},
	}
	for _, c := range cases {
		v := VisitTechnicalView(false, false, c.skip, c.omit, true)
		if v.RevealScheme != c.scheme || v.RevealFormula != c.formula {
			t.Fatalf("skip=%v omit=%v got %+v want scheme=%v formula=%v", c.skip, c.omit, v, c.scheme, c.formula)
		}
	}
}

func TestVisitTechnicalViewFreePeerHidesBoth(t *testing.T) {
	for _, skip := range []bool{false, true} {
		for _, omit := range []bool{false, true} {
			v := VisitTechnicalView(false, false, skip, omit, false)
			if v.RevealScheme || v.RevealFormula {
				t.Fatalf("free peer skip=%v omit=%v: %+v", skip, omit, v)
			}
		}
	}
}

func TestVisitTechnicalViewClientKeepsExistingRules(t *testing.T) {
	open := VisitTechnicalView(false, true, false, true, false)
	if !open.RevealScheme || !open.RevealFormula {
		t.Fatalf("client should see unskipped scheme and formula: %+v", open)
	}
	skipped := VisitTechnicalView(false, true, true, false, true)
	if skipped.RevealScheme || !skipped.RevealFormula {
		t.Fatalf("client should not see skipped scheme: %+v", skipped)
	}
}

func TestCanOmitFormulaRequiresPremium(t *testing.T) {
	if CanOmitFormula(Snapshot{EffectivePlan: PlanFree}) {
		t.Fatal("free cannot omit formula")
	}
	if !CanOmitFormula(Snapshot{EffectivePlan: PlanPremium}) {
		t.Fatal("premium can omit formula")
	}
}

func TestSkipFeatureIndependentFromOmit(t *testing.T) {
	snap := Snapshot{EffectivePlan: PlanPremium, Features: []string{FeatureSkipServiceScheme}}
	if !CanSkipServiceScheme(snap) {
		t.Fatal("skip_service_scheme must still work")
	}
	if !CanOmitFormula(snap) {
		t.Fatal("omit_formula is premium, not the skip feature")
	}
	free := Snapshot{EffectivePlan: PlanFree, Features: []string{}}
	if CanSkipServiceScheme(free) || CanOmitFormula(free) {
		t.Fatal("free has neither skip nor omit")
	}
}
