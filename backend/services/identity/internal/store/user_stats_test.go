package store

import "testing"

func TestAggregateUserStatsExcludesDeletedAndNoDoubleCount(t *testing.T) {
	st := AggregateUserStats(map[string]int{
		"active":  10,
		"blocked": 3,
		"deleted": 7,
	})
	if st.UsersTotal != 13 {
		t.Fatalf("users_total: want 13 (excl deleted), got %d", st.UsersTotal)
	}
	if st.UsersActive != 10 {
		t.Fatalf("users_active: want 10, got %d", st.UsersActive)
	}
	if st.UsersBlocked != 3 {
		t.Fatalf("users_blocked: want 3, got %d", st.UsersBlocked)
	}
	if st.UsersActive+st.UsersBlocked != st.UsersTotal {
		t.Fatalf("active+blocked must equal total; got %d+%d != %d", st.UsersActive, st.UsersBlocked, st.UsersTotal)
	}
}

func TestAggregateUserStatsEmpty(t *testing.T) {
	st := AggregateUserStats(nil)
	if st != (UserStats{}) {
		t.Fatalf("empty: %#v", st)
	}
}

func TestAggregateUserStatsOnlyDeleted(t *testing.T) {
	st := AggregateUserStats(map[string]int{"deleted": 5})
	if st.UsersTotal != 0 || st.UsersActive != 0 || st.UsersBlocked != 0 {
		t.Fatalf("deleted-only must yield zeros: %#v", st)
	}
}

func TestAggregateUserStatsActiveOnly(t *testing.T) {
	st := AggregateUserStats(map[string]int{"active": 4})
	if st.UsersTotal != 4 || st.UsersActive != 4 || st.UsersBlocked != 0 {
		t.Fatalf("%#v", st)
	}
}

func TestAggregateUserStatsBlockedOnly(t *testing.T) {
	st := AggregateUserStats(map[string]int{"blocked": 2})
	if st.UsersTotal != 2 || st.UsersActive != 0 || st.UsersBlocked != 2 {
		t.Fatalf("%#v", st)
	}
}
