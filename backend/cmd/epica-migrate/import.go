package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"
)

func runImport(args []string) error {
	fs := flag.NewFlagSet("import", flag.ContinueOnError)
	exportDir := fs.String("export", "./epica-export", "export directory")
	mappingPath := fs.String("mapping", "", "ID mapping JSON")
	apply := fs.Bool("apply", false, "actually write to TARGET (required)")
	passthrough := fs.Bool("allow-identity-passthrough", false, "local verification only; forbidden for production")
	journalPath := fs.String("journal", "", "journal file path (default: <export>/import-journal.json)")
	if err := parseCommon(fs, args); err != nil {
		return err
	}
	if !*apply {
		return fmt.Errorf("refusing to run without --apply (dry-run first; production apply is out of scope for the default workflow)")
	}
	if *passthrough {
		log.Printf("WARNING: allow-identity-passthrough is set — use only against disposable local targets")
	}

	ctx, cancel := mustContext()
	defer cancel()

	manifest, err := loadSourceManifest(ctx, *exportDir)
	if err != nil {
		return err
	}
	mapping, err := loadMapping(*mappingPath)
	if err != nil {
		return err
	}
	allowPass := *passthrough

	// Re-run safety checks inline (same rules as dry-run against live target).
	target, err := openDBSet(ctx, "TARGET", true)
	if err != nil {
		return err
	}
	defer target.Close()
	tcfg := minioCfgFromEnv("TARGET")
	if err := tcfg.validate("TARGET"); err != nil {
		return err
	}
	tminio, err := openMinio(tcfg)
	if err != nil {
		return err
	}

	uid, err := mapping.remapUser(mustUUID(manifest.LocalAuthorUserID), allowPass)
	if err != nil {
		return err
	}
	ok, err := userExists(ctx, target.Identity, uid)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("mapped user %s missing in TARGET identity", uid)
	}
	if manifest.LocalAuthorOrgID != "" {
		srcOrg := mustUUID(manifest.LocalAuthorOrgID)
		mapped, err := mapping.remapOrg(&srcOrg, allowPass)
		if err != nil {
			return err
		}
		ok, err := orgExists(ctx, target.Orgs, *mapped)
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("mapped organization %s missing in TARGET organizations", mapped)
		}
	}

	journal := ImportJournal{
		StartedAt: time.Now().UTC(),
		ExportDir: *exportDir,
		Stages:    []JournalStage{},
	}
	jp := *journalPath
	if jp == "" {
		jp = filepath.Join(*exportDir, "import-journal.json")
	}

	// Stage 1: MinIO objects
	stageFiles := JournalStage{Name: "minio_objects", Status: "running"}
	copied, skipped, conflicts := 0, 0, 0
	for _, m := range manifest.Media {
		srcPath := mediaFilePath(*exportDir, m)
		if _, err := os.Stat(srcPath); err != nil {
			stageFiles.Status = "failed"
			stageFiles.Detail = fmt.Sprintf("missing file for %s", m.ObjectKey)
			journal.Stages = append(journal.Stages, stageFiles)
			_ = writeJournal(jp, journal)
			return fmt.Errorf("%s", stageFiles.Detail)
		}
		info, err := objectStat(ctx, tminio, tcfg.Bucket, m.ObjectKey)
		if err == nil {
			if info.Size == m.SizeBytes {
				skipped++
				continue
			}
			conflicts++
			stageFiles.Status = "failed"
			stageFiles.Detail = fmt.Sprintf("object conflict %s size %d != %d", m.ObjectKey, info.Size, m.SizeBytes)
			journal.Stages = append(journal.Stages, stageFiles)
			_ = writeJournal(jp, journal)
			return fmt.Errorf("%s", stageFiles.Detail)
		}
		if err := uploadObject(ctx, tminio, tcfg.Bucket, m.ObjectKey, srcPath, m.ContentType); err != nil {
			stageFiles.Status = "failed"
			stageFiles.Detail = fmt.Sprintf("upload %s: %v", m.ObjectKey, err)
			journal.Stages = append(journal.Stages, stageFiles)
			_ = writeJournal(jp, journal)
			return fmt.Errorf("%s", stageFiles.Detail)
		}
		copied++
	}
	stageFiles.Status = "ok"
	stageFiles.Detail = fmt.Sprintf("copied=%d skipped=%d conflicts=%d", copied, skipped, conflicts)
	journal.Stages = append(journal.Stages, stageFiles)
	_ = writeJournal(jp, journal)
	log.Printf("minio: %s", stageFiles.Detail)

	// Stage 2: media_objects
	stageMedia := JournalStage{Name: "media_objects", Status: "running"}
	txm, err := target.Media.Begin(ctx)
	if err != nil {
		return err
	}
	insertedM, skippedM := 0, 0
	for _, m := range manifest.Media {
		exists, cur, err := mediaExists(ctx, target.Media, m.ID)
		if err != nil {
			_ = txm.Rollback(ctx)
			return err
		}
		owner, err := mapping.remapUser(m.OwnerUserID, allowPass)
		if err != nil {
			_ = txm.Rollback(ctx)
			return err
		}
		row := m
		row.OwnerUserID = owner
		row.Bucket = tcfg.Bucket
		if exists {
			if cur.SHA256 != m.SHA256 || cur.ObjectKey != m.ObjectKey {
				_ = txm.Rollback(ctx)
				stageMedia.Status = "failed"
				stageMedia.Detail = fmt.Sprintf("conflict media %s", m.ID)
				journal.Stages = append(journal.Stages, stageMedia)
				_ = writeJournal(jp, journal)
				return fmt.Errorf("%s", stageMedia.Detail)
			}
			skippedM++
			continue
		}
		byKey, other, err := mediaByObjectKey(ctx, target.Media, m.ObjectKey)
		if err != nil {
			_ = txm.Rollback(ctx)
			return err
		}
		if byKey && other.ID != m.ID {
			_ = txm.Rollback(ctx)
			return fmt.Errorf("object_key conflict %s -> %s", m.ObjectKey, other.ID)
		}
		if err := insertMedia(ctx, txm, row); err != nil {
			_ = txm.Rollback(ctx)
			return err
		}
		insertedM++
	}
	if err := txm.Commit(ctx); err != nil {
		return err
	}
	stageMedia.Status = "ok"
	stageMedia.Detail = fmt.Sprintf("inserted=%d skipped=%d", insertedM, skippedM)
	journal.Stages = append(journal.Stages, stageMedia)
	_ = writeJournal(jp, journal)
	log.Printf("media_objects: %s", stageMedia.Detail)

	// Stage 3: knowledge_articles
	stageArt := JournalStage{Name: "knowledge_articles", Status: "running"}
	txa, err := target.Marketplace.Begin(ctx)
	if err != nil {
		return err
	}
	insertedA, skippedA := 0, 0
	for _, a := range manifest.Articles {
		exists, cur, err := articleExists(ctx, target.Marketplace, a.ID)
		if err != nil {
			_ = txa.Rollback(ctx)
			return err
		}
		author, err := mapping.remapUser(a.AuthorUserID, allowPass)
		if err != nil {
			_ = txa.Rollback(ctx)
			return err
		}
		org, err := mapping.remapOrg(a.AuthorOrgID, allowPass)
		if err != nil {
			_ = txa.Rollback(ctx)
			return err
		}
		row := a
		row.AuthorUserID = author
		row.AuthorOrgID = org
		if exists {
			if cur.Title != a.Title || cur.Content != a.Content || cur.Brand != a.Brand {
				_ = txa.Rollback(ctx)
				stageArt.Status = "failed"
				stageArt.Detail = fmt.Sprintf("conflict article %s", a.ID)
				journal.Stages = append(journal.Stages, stageArt)
				_ = writeJournal(jp, journal)
				return fmt.Errorf("%s", stageArt.Detail)
			}
			skippedA++
			continue
		}
		if err := insertArticle(ctx, txa, row); err != nil {
			_ = txa.Rollback(ctx)
			return err
		}
		insertedA++
	}
	if err := txa.Commit(ctx); err != nil {
		return err
	}
	stageArt.Status = "ok"
	stageArt.Detail = fmt.Sprintf("inserted=%d skipped=%d", insertedA, skippedA)
	journal.Stages = append(journal.Stages, stageArt)
	journal.FinishedAt = time.Now().UTC()
	journal.OK = true
	_ = writeJournal(jp, journal)
	log.Printf("knowledge_articles: %s", stageArt.Detail)
	log.Printf("import ok journal=%s", jp)
	return nil
}

type ImportJournal struct {
	StartedAt  time.Time      `json:"started_at"`
	FinishedAt time.Time      `json:"finished_at,omitempty"`
	ExportDir  string         `json:"export_dir"`
	OK         bool           `json:"ok"`
	Stages     []JournalStage `json:"stages"`
}

type JournalStage struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

func writeJournal(path string, j ImportJournal) error {
	raw, err := json.MarshalIndent(j, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o644)
}
