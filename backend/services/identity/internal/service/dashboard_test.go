package service

import "testing"

func TestValidateDashboardWidgetsAcceptsFrontendLayout(t *testing.T) {
	raw := []byte(`[
	  {"id":"alerts","enabled":true,"positions":{"lg":{"x":0,"y":0,"w":12,"h":5}}},
	  {"id":"calendar","enabled":false,"positions":{"lg":{"x":0,"y":5,"w":12,"h":18}}},
	  {"id":"calendar_colors","colors":{"personal":"#aa5533"}}
	]`)
	if err := ValidateDashboardWidgets(raw); err != nil {
		t.Fatalf("frontend layout must be accepted: %v", err)
	}
}

func TestValidateDashboardWidgetsAcceptsLegacyTypeLayout(t *testing.T) {
	raw := []byte(`[
	  {"id":"alerts","type":"important_messages","x":0,"y":0,"w":12,"h":2,"size":"12x2"},
	  {"id":"calendar","type":"calendar","x":0,"y":2,"w":8,"h":6,"size":"8x6"}
	]`)
	if err := ValidateDashboardWidgets(raw); err != nil {
		t.Fatalf("legacy layout must be accepted: %v", err)
	}
}

func TestValidateDashboardWidgetsRejectsUnknown(t *testing.T) {
	if err := ValidateDashboardWidgets([]byte(`[{"id":"not_a_widget"}]`)); err == nil {
		t.Fatal("expected validation error")
	}
	if err := ValidateDashboardWidgets([]byte(`{"id":"calendar"}`)); err == nil {
		t.Fatal("object must be rejected")
	}
}

func TestDefaultWidgetsAreValid(t *testing.T) {
	if err := ValidateDashboardWidgets(defaultWidgets()); err != nil {
		t.Fatalf("defaults must validate: %v", err)
	}
}
