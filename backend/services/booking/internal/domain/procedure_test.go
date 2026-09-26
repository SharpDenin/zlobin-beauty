package domain

import "testing"

func TestKindFromService(t *testing.T) {
	cases := []struct {
		cat, name string
		want      ProcedureKind
	}{
		{"стрижки", "Стрижка", KindHaircut},
		{"колористика", "Окрашивание колориста", KindColoring},
		{"уход", "Уход", KindTreatment},
		{"маникюр", "Снятие покрытия", KindRemoval},
		{"маникюр", "Маникюр", KindCoating},
		{"укладки", "Укладка", KindStyling},
		{"брови", "Коррекция бровей", KindOther},
	}
	for _, tc := range cases {
		if got := KindFromService(tc.cat, tc.name); got != tc.want {
			t.Fatalf("%s/%s = %s want %s", tc.cat, tc.name, got, tc.want)
		}
	}
}

func TestValidateProcedureOrder(t *testing.T) {
	if err := ValidateProcedureOrder([]ProcedureKind{KindHaircut, KindColoring}); err != nil {
		t.Fatal(err)
	}
	if err := ValidateProcedureOrder([]ProcedureKind{KindColoring, KindHaircut}); err == nil {
		t.Fatal("color then haircut must be invalid")
	}
	if err := ValidateProcedureOrder([]ProcedureKind{KindRemoval, KindCoating}); err != nil {
		t.Fatal(err)
	}
	if err := ValidateProcedureOrder([]ProcedureKind{KindCoating, KindRemoval}); err == nil {
		t.Fatal("coating then removal must be invalid")
	}
	if err := ValidateProcedureOrder([]ProcedureKind{KindHaircut, KindOther}); err != nil {
		t.Fatal(err)
	}
}

func TestRecommendedOrderHaircutBeforeColor(t *testing.T) {
	got := RecommendedOrder([]ProcedureKind{KindColoring, KindHaircut})
	if len(got) != 2 || got[0] != 1 || got[1] != 0 {
		t.Fatalf("got %v want [1 0]", got)
	}
}
