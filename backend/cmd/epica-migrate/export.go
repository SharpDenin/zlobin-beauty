package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
)

func runExport(args []string) error {
	fs := flag.NewFlagSet("export", flag.ContinueOnError)
	outDir := fs.String("out", "./epica-export", "export directory")
	skipObjects := fs.Bool("skip-objects", false, "export metadata only (no MinIO download)")
	writeMapping := fs.String("write-mapping-example", "", "optional path to write mapping template with local IDs")
	if err := parseCommon(fs, args); err != nil {
		return err
	}

	ctx, cancel := mustContext()
	defer cancel()

	src, err := openDBSet(ctx, "SOURCE", false)
	if err != nil {
		return err
	}
	defer src.Close()

	articles, err := loadEpicaArticles(ctx, src.Marketplace)
	if err != nil {
		return fmt.Errorf("load articles: %w", err)
	}
	if len(articles) == 0 {
		return fmt.Errorf("no knowledge_articles with brand=%q", epicaBrand)
	}

	mediaIDs := make([]uuid.UUID, 0, len(articles))
	seen := map[uuid.UUID]struct{}{}
	for _, a := range articles {
		if a.CoverMediaID == nil {
			continue
		}
		if _, ok := seen[*a.CoverMediaID]; ok {
			continue
		}
		seen[*a.CoverMediaID] = struct{}{}
		mediaIDs = append(mediaIDs, *a.CoverMediaID)
	}
	mediaRows, err := loadMediaByIDs(ctx, src.Media, mediaIDs)
	if err != nil {
		return fmt.Errorf("load media: %w", err)
	}
	if len(mediaRows) != len(mediaIDs) {
		return fmt.Errorf("cover media mismatch: articles reference %d unique covers, media DB has %d", len(mediaIDs), len(mediaRows))
	}

	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		return err
	}

	var localUser, localOrg string
	localUser = articles[0].AuthorUserID.String()
	if articles[0].AuthorOrgID != nil {
		localOrg = articles[0].AuthorOrgID.String()
	}
	for _, a := range articles {
		if a.AuthorUserID.String() != localUser {
			return fmt.Errorf("epica articles have multiple author_user_id values; unexpected")
		}
		if (a.AuthorOrgID == nil && localOrg != "") || (a.AuthorOrgID != nil && a.AuthorOrgID.String() != localOrg) {
			return fmt.Errorf("epica articles have multiple author_org_id values; unexpected")
		}
	}

	if !*skipObjects {
		mcfg := minioCfgFromEnv("SOURCE")
		if err := mcfg.validate("SOURCE"); err != nil {
			return err
		}
		client, err := openMinio(mcfg)
		if err != nil {
			return err
		}
		log.Printf("downloading %d media objects from MinIO…", len(mediaRows))
		for i, m := range mediaRows {
			dest := mediaFilePath(*outDir, m)
			if err := downloadObject(ctx, client, m.Bucket, m.ObjectKey, dest); err != nil {
				return fmt.Errorf("download %s: %w", m.ObjectKey, err)
			}
			if (i+1)%50 == 0 || i+1 == len(mediaRows) {
				log.Printf("  media %d/%d", i+1, len(mediaRows))
			}
		}
	}

	manifest := ExportManifest{
		Version:           1,
		ExportedAt:        time.Now().UTC(),
		Brand:             epicaBrand,
		SourceNote:        "Selected by brand='EPICA Professional' only",
		ArticleCount:      len(articles),
		MediaCount:        len(mediaRows),
		LocalAuthorUserID: localUser,
		LocalAuthorOrgID:  localOrg,
		Articles:          articles,
		Media:             mediaRows,
	}
	raw, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	if err := os.WriteFile(filepath.Join(*outDir, "manifest.json"), raw, 0o644); err != nil {
		return err
	}

	if *writeMapping != "" {
		if err := writeExampleMapping(*writeMapping, localUser, localOrg); err != nil {
			return err
		}
		log.Printf("wrote mapping example %s", *writeMapping)
	}

	log.Printf("export ok: articles=%d media=%d dir=%s", len(articles), len(mediaRows), *outDir)
	return nil
}
