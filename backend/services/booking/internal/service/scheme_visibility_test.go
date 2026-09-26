package service

import (
	"encoding/json"
	"testing"
)

func TestProjectCategoryFieldsFourCombinations(t *testing.T) {
	raw := json.RawMessage(`{"technique":"балаяж","dye":"Majirel 7.1","notes_key":"keep","oxidizer":"6%"}`)
	cases := []struct {
		scheme, formula bool
		wantDye, wantTech bool
	}{
		{true, true, true, true},
		{true, false, false, true},
		{false, true, true, false},
		{false, false, false, false},
	}
	for _, c := range cases {
		out := projectCategoryFields(raw, c.scheme, c.formula)
		var m map[string]any
		if err := json.Unmarshal(out, &m); err != nil {
			t.Fatalf("skipScheme=%v omit=%v: %v", !c.scheme, !c.formula, err)
		}
		_, dye := m["dye"]
		_, tech := m["technique"]
		if dye != c.wantDye || tech != c.wantTech {
			t.Fatalf("scheme=%v formula=%v got dye=%v tech=%v want dye=%v tech=%v keys=%v",
				c.scheme, c.formula, dye, tech, c.wantDye, c.wantTech, m)
		}
	}
}

func TestProjectCategoryFieldsOmitsEmptyWhenBothHidden(t *testing.T) {
	raw := json.RawMessage(`{"technique":"балаяж","dye":"secret","oxidizer":"6%"}`)
	out := projectCategoryFields(raw, false, false)
	var m map[string]any
	if err := json.Unmarshal(out, &m); err != nil {
		t.Fatal(err)
	}
	if len(m) != 0 {
		t.Fatalf("expected empty projection, got %v", m)
	}
}

func TestHasFormulaContentIndependentOfSkip(t *testing.T) {
	scheme := &VisitSchemeInput{
		Skipped:        true,
		CategoryFields: json.RawMessage(`{"dye":"Majirel 7.1","oxidizer":"6%"}`),
	}
	if !hasFormulaContent(scheme) {
		t.Fatal("formula fields must count even when skip_service_scheme is set")
	}
	empty := &VisitSchemeInput{Skipped: false, Technique: "стрижка"}
	if hasFormulaContent(empty) {
		t.Fatal("technique-only scheme must not count as formula")
	}
}
