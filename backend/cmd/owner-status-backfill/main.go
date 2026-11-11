// Command owner-status-backfill synchronizes marketplace.master_profiles.owner_status
// from Identity users.status (source of truth) by stable user UUID.
//
// Default mode is dry-run. Production apply requires an explicit --apply after a
// successful dry-run with zero missing/unknown statuses.
//
// This task must not run --apply against production without operator confirmation.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
)

func main() {
	log.SetFlags(0)
	fs := flag.NewFlagSet("owner-status-backfill", flag.ExitOnError)
	apply := fs.Bool("apply", false, "write changes (default: dry-run only)")
	batchSize := fs.Int("batch-size", 200, "master_profiles page size")
	resumeAfter := fs.String("resume-after", "", "resume after this user_id (uuid)")
	maxBatches := fs.Int("max-batches", 0, "optional cap on batches (0 = all)")
	reportPath := fs.String("report", "", "optional JSON report path")
	_ = fs.Parse(os.Args[1:])

	mpURL := strings.TrimSpace(os.Getenv("MARKETPLACE_DATABASE_URL"))
	idURL := strings.TrimSpace(os.Getenv("IDENTITY_DATABASE_URL"))
	if mpURL == "" || idURL == "" {
		log.Fatal("MARKETPLACE_DATABASE_URL and IDENTITY_DATABASE_URL are required")
	}

	var after uuid.UUID
	if strings.TrimSpace(*resumeAfter) != "" {
		id, err := uuid.Parse(strings.TrimSpace(*resumeAfter))
		if err != nil {
			log.Fatalf("resume-after: %v", err)
		}
		after = id
	}

	ctx := context.Background()
	mp, err := openPool(ctx, mpURL)
	if err != nil {
		log.Fatalf("marketplace db: %v", err)
	}
	defer mp.Close()
	id, err := openPool(ctx, idURL)
	if err != nil {
		log.Fatalf("identity db: %v", err)
	}
	defer id.Close()

	mode := "dry-run"
	if *apply {
		mode = "apply"
	}
	log.Printf("owner-status-backfill mode=%s batch_size=%d resume_after=%s", mode, *batchSize, after)

	total := PlanResult{}
	batches := 0
	updated := 0
	skippedConcurrent := 0
	skippedDone := 0
	at := time.Now().UTC()

	for {
		if *maxBatches > 0 && batches >= *maxBatches {
			break
		}
		batchCursor := after
		rows, err := ListMasterOwnerRows(ctx, mp, after, *batchSize)
		if err != nil {
			log.Fatalf("list master_profiles: %v (resume-after=%s)", err, ResumeAfterOnFailure(batchCursor))
		}
		if len(rows) == 0 {
			break
		}
		batches++

		ids := make([]uuid.UUID, 0, len(rows))
		seen := map[uuid.UUID]struct{}{}
		for _, r := range rows {
			if _, ok := seen[r.UserID]; ok {
				continue
			}
			seen[r.UserID] = struct{}{}
			ids = append(ids, r.UserID)
		}
		byUser, err := FetchIdentityStatuses(ctx, id, ids)
		if err != nil {
			log.Fatalf("identity statuses: %v (resume-after=%s)", err, ResumeAfterOnFailure(batchCursor))
		}
		plan := BuildPlan(rows, byUser)
		total.Scanned += plan.Scanned
		total.Unchanged += plan.Unchanged
		total.Changes = append(total.Changes, plan.Changes...)
		total.Missing = append(total.Missing, plan.Missing...)
		total.Unknown = append(total.Unknown, plan.Unknown...)
		total.Errors = append(total.Errors, plan.Errors...)

		log.Printf("batch=%d scanned=%d changes=%d unchanged=%d missing=%d unknown=%d errors=%d last_user=%s",
			batches, plan.Scanned, len(plan.Changes), plan.Unchanged, len(plan.Missing), len(plan.Unknown), len(plan.Errors), rows[len(rows)-1].UserID)

		if *apply {
			if err := PlanBlocksApply(plan); err != nil {
				log.Fatalf("refusing apply: %v (resume-after=%s)", err, ResumeAfterOnFailure(batchCursor))
			}
			for _, c := range plan.Changes {
				// Fresh Identity+marketplace read + CAS — never write a stale planned status.
				res, err := ApplyChangeFresh(ctx, mp, id, c, at)
				if err != nil {
					log.Fatalf("apply profile %s: %v (resume-after=%s)", c.ProfileID, err, ResumeAfterOnFailure(batchCursor))
				}
				switch {
				case res.Applied:
					updated++
				case res.SkippedConcurrent:
					skippedConcurrent++
					log.Printf("skip concurrent profile=%s user=%s (resume keeps batch)", c.ProfileID, c.UserID)
				case res.SkippedAlreadyDone:
					skippedDone++
				}
			}
		}

		// Advance cursor only after the whole batch succeeds.
		after = NextResumeAfter(rows)
		if len(rows) < *batchSize {
			break
		}
	}

	log.Printf("summary scanned=%d unchanged=%d planned_changes=%d applied=%d skipped_concurrent=%d skipped_done=%d missing=%d unknown=%d errors=%d batches=%d",
		total.Scanned, total.Unchanged, len(total.Changes), updated, skippedConcurrent, skippedDone, len(total.Missing), len(total.Unknown), len(total.Errors), batches)

	if *reportPath != "" {
		payload := map[string]any{
			"mode": mode, "scanned": total.Scanned, "unchanged": total.Unchanged,
			"planned_changes": len(total.Changes), "applied": updated,
			"skipped_concurrent": skippedConcurrent, "skipped_already_done": skippedDone,
			"missing": total.Missing, "unknown": total.Unknown, "errors": total.Errors,
			"sample_changes": sampleChanges(total.Changes, 50),
			"resume_after":   after.String(),
		}
		raw, _ := json.MarshalIndent(payload, "", "  ")
		if err := os.WriteFile(*reportPath, raw, 0o600); err != nil {
			log.Fatalf("write report: %v", err)
		}
		log.Printf("wrote report %s", *reportPath)
	}

	if !*apply {
		if err := PlanBlocksApply(total); err != nil {
			log.Fatalf("dry-run incomplete: %v", err)
		}
		log.Printf("dry-run ok — re-run with --apply to write %d changes", len(total.Changes))
		return
	}
	if err := PlanBlocksApply(total); err != nil {
		log.Fatalf("apply finished with unresolved issues: %v", err)
	}
	log.Printf("apply ok")
}

func sampleChanges(in []Change, n int) []Change {
	if len(in) <= n {
		return in
	}
	return in[:n]
}
