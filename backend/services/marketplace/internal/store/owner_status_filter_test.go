package store

import "testing"

func TestOwnerStatusSQLGated(t *testing.T) {
	s := &Store{}
	if got := s.ownerStatusSQL("mp"); got != "" {
		t.Fatalf("disabled filter must be empty, got %q", got)
	}
	s.OwnerStatusSearchFilter = true
	got := s.ownerStatusSQL("mp")
	if got != " AND mp.owner_status = 'active'" {
		t.Fatalf("got %q", got)
	}
}
