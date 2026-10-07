package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
)

func branchExists(c *http.Client, base string, user authUser, orgID, name, city, address string) bool {
	var mine struct {
		Items []struct {
			Organization struct {
				ID string `json:"id"`
			} `json:"organization"`
			Branches []struct {
				Name    string `json:"name"`
				City    string `json:"city"`
				Address string `json:"address_line"`
			} `json:"branches"`
		} `json:"items"`
	}
	st, err := doJSON(c, http.MethodGet, base+"/v1/organizations/mine", user.Token, nil, &mine)
	if err != nil || st >= 300 {
		return false
	}
	wantName := strings.ToLower(strings.TrimSpace(name))
	wantCity := strings.ToLower(strings.TrimSpace(city))
	wantAddr := strings.ToLower(strings.TrimSpace(address))
	for _, it := range mine.Items {
		if it.Organization.ID != orgID {
			continue
		}
		for _, b := range it.Branches {
			if strings.ToLower(strings.TrimSpace(b.Name)) == wantName &&
				strings.ToLower(strings.TrimSpace(b.City)) == wantCity &&
				strings.ToLower(strings.TrimSpace(b.Address)) == wantAddr {
				return true
			}
		}
	}
	return false
}

// dedupeIdenticalBranches removes extra branches that share organization, name, city and address.
// The oldest row is kept. Referenced ids in marketplace and booking are moved onto it first.
// Different addresses in the same city are left alone.
func dedupeIdenticalBranches() {
	orgDSN := strings.TrimSpace(os.Getenv("ORGANIZATIONS_DATABASE_URL"))
	if orgDSN == "" {
		log.Printf("skip branch dedupe — ORGANIZATIONS_DATABASE_URL not set")
		return
	}
	ctx := context.Background()
	orgConn, err := pgx.Connect(ctx, orgDSN)
	if err != nil {
		log.Printf("warn branch dedupe connect: %v", err)
		return
	}
	defer orgConn.Close(ctx)

	rows, err := orgConn.Query(ctx, `
SELECT id::text, organization_id::text, lower(btrim(name)), lower(btrim(city)), lower(btrim(address_line)), created_at
FROM branches
ORDER BY created_at ASC, id ASC`)
	if err != nil {
		log.Printf("warn branch dedupe list: %v", err)
		return
	}
	type row struct {
		id, org, name, city, address string
	}
	var all []row
	for rows.Next() {
		var item row
		var createdAt any
		if err := rows.Scan(&item.id, &item.org, &item.name, &item.city, &item.address, &createdAt); err != nil {
			rows.Close()
			log.Printf("warn branch dedupe scan: %v", err)
			return
		}
		all = append(all, item)
	}
	rows.Close()

	keep := map[string]string{}
	var dupes []struct{ drop, canonical string }
	for _, item := range all {
		key := item.org + "|" + item.name + "|" + item.city + "|" + item.address
		if prev, ok := keep[key]; ok {
			dupes = append(dupes, struct{ drop, canonical string }{item.id, prev})
			continue
		}
		keep[key] = item.id
	}
	if len(dupes) == 0 {
		log.Printf("ok branch dedupe — no identical branches")
		return
	}

	move := func(dsn, sql string, args ...any) {
		if strings.TrimSpace(dsn) == "" {
			return
		}
		conn, err := pgx.Connect(ctx, dsn)
		if err != nil {
			log.Printf("warn branch dedupe satellite: %v", err)
			return
		}
		defer conn.Close(ctx)
		if _, err := conn.Exec(ctx, sql, args...); err != nil {
			log.Printf("warn branch dedupe reassign: %v", err)
		}
	}

	market := os.Getenv("MARKETPLACE_DATABASE_URL")
	booking := os.Getenv("BOOKING_DATABASE_URL")
	removed := 0
	for _, d := range dupes {
		move(market, `UPDATE master_profiles SET branch_id=$1::uuid WHERE branch_id=$2::uuid`, d.canonical, d.drop)
		move(booking, `UPDATE appointments SET branch_id=$1::uuid WHERE branch_id=$2::uuid`, d.canonical, d.drop)
		tag, err := orgConn.Exec(ctx, `DELETE FROM branches WHERE id=$1::uuid`, d.drop)
		if err != nil {
			log.Printf("warn delete duplicate branch %s: %v", d.drop, err)
			continue
		}
		removed += int(tag.RowsAffected())
	}
	log.Printf("ok branch dedupe removed=%d", removed)
}
