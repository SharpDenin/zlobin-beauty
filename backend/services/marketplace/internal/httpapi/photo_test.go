package httpapi

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/domain"
)

func TestApplyPhotoMediaField(t *testing.T) {
	id := uuid.MustParse("550e8400-e29b-41d4-a716-446655440000")

	tests := []struct {
		name    string
		raw     json.RawMessage
		clear   bool
		wantID  *uuid.UUID
		wantErr bool
	}{
		{name: "omitted nil", raw: nil},
		{name: "omitted empty", raw: json.RawMessage{}},
		{name: "json null", raw: json.RawMessage("null"), clear: true},
		{name: "empty string", raw: json.RawMessage(`""`), clear: true},
		{name: "uuid", raw: json.RawMessage(`"550e8400-e29b-41d4-a716-446655440000"`), wantID: &id},
		{name: "invalid uuid", raw: json.RawMessage(`"not-a-uuid"`), wantErr: true},
		{name: "non string", raw: json.RawMessage(`1`), wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := applyPhotoMediaField(tt.raw)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got.ClearPhoto != tt.clear {
				t.Fatalf("ClearPhoto=%v want %v", got.ClearPhoto, tt.clear)
			}
			if tt.wantID == nil {
				if got.PhotoMediaID != nil {
					t.Fatalf("PhotoMediaID=%v want nil", got.PhotoMediaID)
				}
				return
			}
			if got.PhotoMediaID == nil || *got.PhotoMediaID != *tt.wantID {
				t.Fatalf("PhotoMediaID=%v want %v", got.PhotoMediaID, tt.wantID)
			}
		})
	}
}

func TestParseOptionalUUID(t *testing.T) {
	id := uuid.MustParse("550e8400-e29b-41d4-a716-446655440000")
	s := id.String()
	empty := ""

	got, err := parseOptionalUUID(nil)
	if err != nil || got != nil {
		t.Fatalf("nil pointer: got %v err %v", got, err)
	}
	got, err = parseOptionalUUID(&empty)
	if err != nil || got != nil {
		t.Fatalf("empty string: got %v err %v", got, err)
	}
	got, err = parseOptionalUUID(&s)
	if err != nil || got == nil || *got != id {
		t.Fatalf("uuid: got %v err %v", got, err)
	}
}

func TestServiceDTOPhotoOptional(t *testing.T) {
	item := domain.ServiceItem{
		ID:              uuid.MustParse("11111111-1111-4111-8111-111111111011"),
		OrganizationID:  uuid.MustParse("11111111-1111-4111-8111-111111111012"),
		Name:            "Стрижка",
		Category:        "волосы",
		DurationMinutes: 60,
		PriceMinor:      150000,
		Currency:        "RUB",
		BookingMode:     "flexible",
		Published:       true,
	}

	without, err := json.Marshal(serviceDTO(item))
	if err != nil {
		t.Fatal(err)
	}
	var noPhoto map[string]any
	if err := json.Unmarshal(without, &noPhoto); err != nil {
		t.Fatal(err)
	}
	if noPhoto["photo_media_id"] != nil {
		t.Fatalf("expected JSON null photo_media_id, got %#v", noPhoto["photo_media_id"])
	}

	pid := uuid.MustParse("550e8400-e29b-41d4-a716-446655440000")
	item.PhotoMediaID = &pid
	with, err := json.Marshal(serviceDTO(item))
	if err != nil {
		t.Fatal(err)
	}
	var hasPhoto map[string]any
	if err := json.Unmarshal(with, &hasPhoto); err != nil {
		t.Fatal(err)
	}
	if hasPhoto["photo_media_id"] != pid.String() {
		t.Fatalf("photo_media_id=%v want %s", hasPhoto["photo_media_id"], pid)
	}
}
