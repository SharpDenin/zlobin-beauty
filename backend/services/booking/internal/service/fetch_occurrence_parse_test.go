package service

import (
	"encoding/json"
	"testing"
)

func TestOccurrencePayloadAcceptsWrappedAndBareJSON(t *testing.T) {
	bareRaw := []byte(`{"id":"occ-1","service_id":"svc-1","master_user_id":"m-1","status":"scheduled","capacity":3,"booked_count":0}`)
	wrappedRaw := []byte(`{"occurrence":{"id":"occ-2","service_id":"svc-1","master_user_id":"m-1","status":"scheduled","capacity":2,"booked_count":1}}`)

	parse := func(body []byte) (occurrencePayload, error) {
		var wrapped struct {
			Occurrence occurrencePayload `json:"occurrence"`
		}
		var bare occurrencePayload
		if err := json.Unmarshal(body, &wrapped); err == nil && wrapped.Occurrence.ID != "" {
			return wrapped.Occurrence, nil
		}
		if err := json.Unmarshal(body, &bare); err != nil || bare.ID == "" {
			return occurrencePayload{}, err
		}
		return bare, nil
	}

	got, err := parse(bareRaw)
	if err != nil || got.ID != "occ-1" {
		t.Fatalf("bare: got %+v err=%v", got, err)
	}
	got, err = parse(wrappedRaw)
	if err != nil || got.ID != "occ-2" {
		t.Fatalf("wrapped: got %+v err=%v", got, err)
	}

	// Regression: unmarshalling a bare object into the wrapped shape must not
	// be treated as a successful empty occurrence.
	var wrapped struct {
		Occurrence occurrencePayload `json:"occurrence"`
	}
	if err := json.Unmarshal(bareRaw, &wrapped); err != nil {
		t.Fatal(err)
	}
	if wrapped.Occurrence.ID != "" {
		t.Fatal("expected empty wrapped occurrence for bare JSON")
	}
}
