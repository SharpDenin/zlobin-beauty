package service

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/clients/internal/domain"
)

func TestRedactColorFormulaHidesTechnicalFields(t *testing.T) {
	id := uuid.New()
	f := domain.ColorFormula{
		ID: id, Name: "Majirel 7.1", Brand: "Loreal", Components: json.RawMessage(`[{"label":"7.1"}]`),
		Oxidizer: "6%", Ratio: "1:1.5", Comment: "secret", OmitFormula: true,
	}
	hidden := redactColorFormula(f, false)
	if !hidden.Redacted {
		t.Fatal("expected redacted")
	}
	if hidden.Name != "" || hidden.Brand != "" || hidden.Oxidizer != "" || hidden.Ratio != "" || hidden.Comment != "" {
		t.Fatalf("technical fields leaked: %+v", hidden)
	}
	if string(hidden.Components) != "[]" {
		t.Fatalf("components leaked: %s", hidden.Components)
	}
	if hidden.ID != id || !hidden.OmitFormula {
		t.Fatal("identity flags must remain")
	}
	shown := redactColorFormula(f, true)
	if shown.Redacted || shown.Name != "Majirel 7.1" {
		t.Fatal("owner/allowed viewer must see formula")
	}
}
