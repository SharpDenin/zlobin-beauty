package store

// AggregateUserStats computes platform user counters from status tallies.
// users_total = registered accounts excluding soft-deleted (status <> deleted).
// users_active / users_blocked are disjoint status buckets; deleted are never double-counted.
func AggregateUserStats(byStatus map[string]int) UserStats {
	active := byStatus["active"]
	blocked := byStatus["blocked"]
	return UserStats{
		UsersTotal:   active + blocked,
		UsersActive:  active,
		UsersBlocked: blocked,
	}
}
