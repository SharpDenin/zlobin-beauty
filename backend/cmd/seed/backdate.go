package main

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// seedBackdatedSalonDay inserts completed (and one in-progress) visits on *today*
// in the salon timezone so owner home is never empty after hours.
// Requires BOOKING_DATABASE_URL. Safe/idempotent: skips when today already has rows.
func seedBackdatedSalonDay(orgID, branchID, masterUserID, colorServiceID, cutServiceID string, clients []authUser, tzName string) error {
	dsn := strings.TrimSpace(os.Getenv("BOOKING_DATABASE_URL"))
	if dsn == "" {
		log.Printf("skip backdated salon day — BOOKING_DATABASE_URL not set")
		return nil
	}
	if orgID == "" || branchID == "" || masterUserID == "" || colorServiceID == "" || len(clients) == 0 {
		return nil
	}
	loc, err := time.LoadLocation(tzName)
	if err != nil {
		loc = time.Local
	}
	now := time.Now().In(loc)
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)

	org, err := uuid.Parse(orgID)
	if err != nil {
		return err
	}
	branch, err := uuid.Parse(branchID)
	if err != nil {
		return err
	}
	master, err := uuid.Parse(masterUserID)
	if err != nil {
		return err
	}
	colorSvc, err := uuid.Parse(colorServiceID)
	if err != nil {
		return err
	}
	cutSvc := colorSvc
	if cutServiceID != "" {
		if parsed, perr := uuid.Parse(cutServiceID); perr == nil {
			cutSvc = parsed
		}
	}

	var existing int
	if err := conn.QueryRow(ctx, `
SELECT COUNT(*) FROM appointments
WHERE organization_id=$1 AND starts_at >= $2 AND starts_at < $3`,
		org, dayStart.UTC(), dayStart.Add(24*time.Hour).UTC()).Scan(&existing); err != nil {
		return err
	}
	if existing >= 3 {
		log.Printf("skip backdated salon day — already %d appointments today", existing)
		return nil
	}

	type row struct {
		hour, min, dur int
		status         string
		service        uuid.UUID
		name           string
		price          int64
		clientIdx      int
	}
	specs := []row{
		{11, 0, 60, "completed", cutSvc, "Стрижка", 280000, 0},
		{13, 0, 90, "completed", colorSvc, "Уход", 420000, 1 % len(clients)},
		{15, 30, 60, "in_progress", cutSvc, "Стрижка", 280000, 0},
	}
	inserted := 0
	for _, spec := range specs {
		client := clients[spec.clientIdx%len(clients)]
		cid, err := uuid.Parse(client.ID)
		if err != nil {
			continue
		}
		start := time.Date(now.Year(), now.Month(), now.Day(), spec.hour, spec.min, 0, 0, loc)
		end := start.Add(time.Duration(spec.dur) * time.Minute)
		id := uuid.New()
		_, err = conn.Exec(ctx, `
INSERT INTO appointments(
  id, organization_id, branch_id, master_user_id, client_user_id, service_id, service_name,
  duration_minutes, price_minor, currency, status, starts_at, ends_at, created_at, updated_at,
  booking_mode, location_name, location_city, location_address, location_timezone, cancel_reason
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'RUB',$10,$11,$12,$13,$13,'flexible','Красноярск, Ленина','Красноярск','ул. Ленина, 50',$14,'')`,
			id, org, branch, master, cid, spec.service, spec.name,
			spec.dur, spec.price, spec.status, start.UTC(), end.UTC(), time.Now().UTC(), tzName)
		if err != nil {
			log.Printf("warn backdate insert %s %02d:%02d: %v", spec.status, spec.hour, spec.min, err)
			continue
		}
		inserted++
	}
	log.Printf("ok backdated salon day inserted=%d tz=%s", inserted, tzName)
	return nil
}
