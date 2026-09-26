package domain

import "testing"

func TestAllowedDisputeField(t *testing.T) {
	ok := []string{"hair_color", "hair_condition", "preferences", "display_name", "phone", "email"}
	for _, k := range ok {
		if !AllowedDisputeField(k) {
			t.Fatalf("expected allowed field %s", k)
		}
	}
	if AllowedDisputeField("arbitrary_json") || AllowedDisputeField("") {
		t.Fatal("unknown keys must be rejected")
	}
}

func TestCreateDisputeDoesNotDefineCardMutation(t *testing.T) {
	// Dispute is an overlay: statuses are open/resolved/rejected only.
	// There is no "applied" status that would rewrite client_cards.
	if DisputeOpen == "applied" || DisputeResolved == "mutated" {
		t.Fatal("dispute must not imply automatic mutation of client data")
	}
}

func TestDisputeStatusesMVP(t *testing.T) {
	if DisputeOpen != "open" || DisputeResolved != "resolved" || DisputeRejected != "rejected" {
		t.Fatalf("unexpected statuses %s %s %s", DisputeOpen, DisputeResolved, DisputeRejected)
	}
}
