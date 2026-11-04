// Command epica-migrate exports, dry-runs, and imports EPICA Professional
// knowledge-base data (articles + cover media) between Salon-X databases.
//
// It never prints secrets. Production apply requires an explicit --apply flag
// after a successful dry-run. This task must not run --apply against production.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"
)

const epicaBrand = "EPICA Professional"

func main() {
	log.SetFlags(0)
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	cmd := os.Args[1]
	args := os.Args[2:]
	var err error
	switch cmd {
	case "export":
		err = runExport(args)
	case "dry-run":
		err = runDryRun(args)
	case "import":
		err = runImport(args)
	case "help", "-h", "--help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n", cmd)
		usage()
		os.Exit(2)
	}
	if err != nil {
		log.Fatalf("error: %v", err)
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, `epica-migrate — transfer EPICA Professional knowledge data

Commands:
  export   Export Epica articles + cover media from a source environment
  dry-run  Compare a source export (or live source) against a target (read-only)
  import   Apply an export to a target (requires successful dry-run + --apply)

Selection rule (source of truth):
  marketplace.knowledge_articles WHERE brand = 'EPICA Professional'
  + media.media_objects referenced by cover_media_id
  + MinIO objects for those media rows

NOT transferred:
  demo users/orgs, memberships, favorites, commerce products, portfolio,
  unrelated knowledge brands, test appointments/orders.

Environment (never commit real values):
  SOURCE_MARKETPLACE_DATABASE_URL / TARGET_MARKETPLACE_DATABASE_URL
  SOURCE_MEDIA_DATABASE_URL       / TARGET_MEDIA_DATABASE_URL
  SOURCE_IDENTITY_DATABASE_URL    / TARGET_IDENTITY_DATABASE_URL   (mapping checks)
  SOURCE_ORGANIZATIONS_DATABASE_URL / TARGET_ORGANIZATIONS_DATABASE_URL
  SOURCE_MINIO_ENDPOINT, SOURCE_MINIO_ACCESS_KEY, SOURCE_MINIO_SECRET_KEY, SOURCE_MINIO_BUCKET, SOURCE_MINIO_USE_SSL
  TARGET_MINIO_* (same shape)

See docs/EPICA_MIGRATION.md
`)
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func mustContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 30*time.Minute)
}

func parseCommon(fs *flag.FlagSet, args []string) error {
	return fs.Parse(args)
}
