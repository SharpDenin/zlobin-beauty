package httpapi

import (
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/marketplace/internal/store"
)

func TestSearchCursorRoundTrip(t *testing.T) {
	id := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	raw := encodeSearchCursor(store.SearchCursor{
		CityRank: 1, RatingAvg: 4.75, RatingCount: 12, ID: id,
	})
	got, err := decodeSearchCursor(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got.CityRank != 1 || got.RatingAvg != 4.75 || got.RatingCount != 12 || got.ID != id {
		t.Fatalf("round-trip mismatch %#v", got)
	}
}

func TestDecodeSearchCursorRejectsGarbage(t *testing.T) {
	if _, err := decodeSearchCursor("%%%"); err == nil {
		t.Fatal("expected error")
	}
	if _, err := decodeSearchCursor(encodeSearchCursor(store.SearchCursor{})); err == nil {
		t.Fatal("nil id must fail")
	}
}
