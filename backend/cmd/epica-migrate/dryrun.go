package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
)

func runDryRun(args []string) error {
	fs := flag.NewFlagSet("dry-run", flag.ContinueOnError)
	exportDir := fs.String("export", "", "path to export dir (manifest.json + objects/). If empty, read live SOURCE_*")
	mappingPath := fs.String("mapping", "", "ID mapping JSON (required unless --assume-empty-target with identity checks skipped)")
	assumeEmpty := fs.Bool("assume-empty-target", false, "do not connect to target DBs/MinIO; report all rows as would-create")
	passthrough := fs.Bool("allow-identity-passthrough", false, "allow mapping src→same id (local verification only; never for production)")
	outJSON := fs.String("report", "", "optional path to write JSON report")
	if err := parseCommon(fs, args); err != nil {
		return err
	}
	allowPass := *passthrough

	ctx, cancel := mustContext()
	defer cancel()

	manifest, err := loadSourceManifest(ctx, *exportDir)
	if err != nil {
		return err
	}

	report := DryRunReport{
		Brand: epicaBrand,
		Notes: []string{
			"Selection: knowledge_articles.brand = 'EPICA Professional' + cover media_objects + MinIO objects.",
			"Demo users/orgs are never inserted; mapping must point to existing production entities.",
			"Existing target rows matched by primary key are skipped (no overwrite).",
			"Conflict = same PK with different content/sha, or object_key owned by a different media id/sha.",
		},
	}

	var mapping *Mapping
	if !*assumeEmpty {
		mapping, err = loadMapping(*mappingPath)
		if err != nil {
			return err
		}
	} else {
		// Planning mode: do not require real production UUIDs yet.
		mapping = &Mapping{
			Users:         map[string]string{manifest.LocalAuthorUserID: "00000000-0000-4000-8000-000000000001"},
			Organizations: map[string]string{},
		}
		if manifest.LocalAuthorOrgID != "" {
			mapping.Organizations[manifest.LocalAuthorOrgID] = "00000000-0000-4000-8000-000000000002"
		}
		if strings.TrimSpace(*mappingPath) != "" {
			if m2, err := loadMapping(*mappingPath); err == nil {
				if _, ok := m2.Users[manifest.LocalAuthorUserID]; !ok {
					report.MappingErrors = append(report.MappingErrors, "mapping file missing local author user key")
				}
				if manifest.LocalAuthorOrgID != "" {
					if _, ok := m2.Organizations[manifest.LocalAuthorOrgID]; !ok {
						report.MappingErrors = append(report.MappingErrors, "mapping file missing local author org key")
					}
				}
			} else {
				return err
			}
		}
		report.Notes = append(report.Notes, "--assume-empty-target uses synthetic target UUIDs for counts; fill real mapping before import.")
	}

	if allowPass {
		report.Notes = append(report.Notes, "allow-identity-passthrough enabled — local verification only.")
	}

	// Validate mapping shape against export
	if _, err := mapping.remapUser(mustUUID(manifest.LocalAuthorUserID), allowPass); err != nil {
		report.MappingErrors = append(report.MappingErrors, err.Error())
	}
	if manifest.LocalAuthorOrgID != "" {
		org := mustUUID(manifest.LocalAuthorOrgID)
		if _, err := mapping.remapOrg(&org, allowPass); err != nil {
			report.MappingErrors = append(report.MappingErrors, err.Error())
		}
	}
	report.MappingOK = len(report.MappingErrors) == 0

	var target *DBSet
	var targetMinio *minio.Client
	var targetBucket string
	if !*assumeEmpty {
		target, err = openDBSet(ctx, "TARGET", true)
		if err != nil {
			return err
		}
		defer target.Close()
		tcfg := minioCfgFromEnv("TARGET")
		if err := tcfg.validate("TARGET"); err != nil {
			return err
		}
		targetMinio, err = openMinio(tcfg)
		if err != nil {
			return err
		}
		targetBucket = tcfg.Bucket

		// Mapping targets must exist.
		if report.MappingOK {
			uid, _ := mapping.remapUser(mustUUID(manifest.LocalAuthorUserID), allowPass)
			ok, err := userExists(ctx, target.Identity, uid)
			if err != nil {
				return err
			}
			if !ok {
				report.MappingErrors = append(report.MappingErrors, fmt.Sprintf("mapped user %s not found in TARGET identity", uid))
			}
			if manifest.LocalAuthorOrgID != "" {
				oid := mustUUID(manifest.LocalAuthorOrgID)
				mapped, _ := mapping.remapOrg(&oid, allowPass)
				ok, err := orgExists(ctx, target.Orgs, *mapped)
				if err != nil {
					return err
				}
				if !ok {
					report.MappingErrors = append(report.MappingErrors, fmt.Sprintf("mapped organization %s not found in TARGET organizations", mapped))
				}
			}
			report.MappingOK = len(report.MappingErrors) == 0
		}
	}

	mediaReport := TableReport{Table: "media.media_objects", SourceRows: len(manifest.Media)}
	articleReport := TableReport{Table: "marketplace.knowledge_articles", SourceRows: len(manifest.Articles)}
	files := FileSummary{Total: len(manifest.Media)}

	for _, m := range manifest.Media {
		owner, err := mapping.remapUser(m.OwnerUserID, allowPass)
		planned := m
		if err != nil {
			mediaReport.MissingDeps++
			mediaReport.Conflicts++
			if len(mediaReport.MissingSamples) < 5 {
				mediaReport.MissingSamples = append(mediaReport.MissingSamples, fmt.Sprintf("media %s: %v", m.ID, err))
			}
			continue
		}
		planned.OwnerUserID = owner

		outcome := OutcomeCreate
		detail := ""
		if *assumeEmpty {
			mediaReport.WouldCreate++
		} else {
			exists, cur, err := mediaExists(ctx, target.Media, m.ID)
			if err != nil {
				return err
			}
			if exists {
				if cur.SHA256 != m.SHA256 || cur.ObjectKey != m.ObjectKey {
					outcome = OutcomeConflict
					detail = fmt.Sprintf("id exists with different sha/key (target sha=%s key=%s)", cur.SHA256, cur.ObjectKey)
					mediaReport.Conflicts++
					if len(mediaReport.ConflictSamples) < 5 {
						mediaReport.ConflictSamples = append(mediaReport.ConflictSamples, detail)
					}
				} else {
					outcome = OutcomeExists
					mediaReport.AlreadyExists++
				}
			} else {
				byKey, other, err := mediaByObjectKey(ctx, target.Media, m.ObjectKey)
				if err != nil {
					return err
				}
				if byKey && other.ID != m.ID {
					outcome = OutcomeConflict
					detail = fmt.Sprintf("object_key %s already used by media %s", m.ObjectKey, other.ID)
					mediaReport.Conflicts++
					if len(mediaReport.ConflictSamples) < 5 {
						mediaReport.ConflictSamples = append(mediaReport.ConflictSamples, detail)
					}
				} else {
					mediaReport.WouldCreate++
				}
			}
		}

		// Files
		fr := FileReport{ObjectKey: m.ObjectKey, SizeBytes: m.SizeBytes, Outcome: string(outcome)}
		if *exportDir != "" {
			fr.LocalPath = mediaFilePath(*exportDir, m)
			if st, err := os.Stat(fr.LocalPath); err != nil || st.Size() == 0 {
				fr.Outcome = "missing_source"
				fr.Detail = "export object file missing"
				files.MissingSource++
			}
		}
		if !*assumeEmpty && targetMinio != nil && fr.Outcome != "missing_source" && outcome != OutcomeConflict {
			info, err := objectStat(ctx, targetMinio, targetBucket, m.ObjectKey)
			if err == nil {
				if info.Size == m.SizeBytes {
					fr.Outcome = "exists"
					files.AlreadyPresent++
				} else {
					fr.Outcome = "conflict"
					fr.Detail = fmt.Sprintf("target object size %d != source %d", info.Size, m.SizeBytes)
					files.Conflicts++
				}
			} else if outcome == OutcomeCreate || outcome == OutcomeExists {
				// not present — would copy
				if fr.Outcome != "missing_source" {
					fr.Outcome = "copy"
					files.WouldCopy++
				}
			}
		} else if *assumeEmpty && fr.Outcome != "missing_source" {
			fr.Outcome = "copy"
			files.WouldCopy++
		}
		if len(files.Samples) < 8 {
			files.Samples = append(files.Samples, fr)
		}
		_ = planned
	}

	for _, a := range manifest.Articles {
		if _, err := mapping.remapUser(a.AuthorUserID, allowPass); err != nil {
			articleReport.MissingDeps++
			if len(articleReport.MissingSamples) < 5 {
				articleReport.MissingSamples = append(articleReport.MissingSamples, fmt.Sprintf("article %s: %v", a.ID, err))
			}
			continue
		}
		if _, err := mapping.remapOrg(a.AuthorOrgID, allowPass); err != nil {
			articleReport.MissingDeps++
			if len(articleReport.MissingSamples) < 5 {
				articleReport.MissingSamples = append(articleReport.MissingSamples, fmt.Sprintf("article %s: %v", a.ID, err))
			}
			continue
		}
		if a.CoverMediaID == nil {
			articleReport.Conflicts++
			articleReport.ConflictSamples = appendSample(articleReport.ConflictSamples, fmt.Sprintf("article %s missing cover_media_id", a.ID))
			continue
		}
		if *assumeEmpty {
			articleReport.WouldCreate++
			continue
		}
		exists, cur, err := articleExists(ctx, target.Marketplace, a.ID)
		if err != nil {
			return err
		}
		if !exists {
			articleReport.WouldCreate++
			continue
		}
		if cur.Title != a.Title || cur.Content != a.Content || cur.Brand != a.Brand {
			articleReport.Conflicts++
			articleReport.ConflictSamples = appendSample(articleReport.ConflictSamples,
				fmt.Sprintf("article %s exists with different title/content/brand", a.ID))
		} else {
			articleReport.AlreadyExists++
		}
	}

	report.Tables = []TableReport{mediaReport, articleReport}
	report.Files = files

	if !report.MappingOK {
		report.BlockedReasons = append(report.BlockedReasons, "mapping invalid or target entities missing")
	}
	if mediaReport.Conflicts > 0 || articleReport.Conflicts > 0 || files.Conflicts > 0 {
		report.BlockedReasons = append(report.BlockedReasons, "conflicts detected (will not overwrite)")
	}
	if mediaReport.MissingDeps > 0 || articleReport.MissingDeps > 0 {
		report.BlockedReasons = append(report.BlockedReasons, "missing mapped dependencies")
	}
	if files.MissingSource > 0 {
		report.BlockedReasons = append(report.BlockedReasons, "export is missing object files")
	}
	report.Safe = len(report.BlockedReasons) == 0

	printDryRun(report)
	if *outJSON != "" {
		raw, err := json.MarshalIndent(report, "", "  ")
		if err != nil {
			return err
		}
		raw = append(raw, '\n')
		if err := os.WriteFile(*outJSON, raw, 0o644); err != nil {
			return err
		}
		log.Printf("wrote report %s", *outJSON)
	}
	if !report.Safe {
		return fmt.Errorf("dry-run BLOCKED")
	}
	log.Printf("dry-run SAFE")
	return nil
}

func loadSourceManifest(ctx context.Context, exportDir string) (*ExportManifest, error) {
	if strings.TrimSpace(exportDir) != "" {
		raw, err := os.ReadFile(filepath.Join(exportDir, "manifest.json"))
		if err != nil {
			return nil, err
		}
		var m ExportManifest
		if err := json.Unmarshal(raw, &m); err != nil {
			return nil, err
		}
		return &m, nil
	}
	src, err := openDBSet(ctx, "SOURCE", false)
	if err != nil {
		return nil, err
	}
	defer src.Close()
	articles, err := loadEpicaArticles(ctx, src.Marketplace)
	if err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, 0)
	seen := map[uuid.UUID]struct{}{}
	for _, a := range articles {
		if a.CoverMediaID == nil {
			continue
		}
		if _, ok := seen[*a.CoverMediaID]; ok {
			continue
		}
		seen[*a.CoverMediaID] = struct{}{}
		ids = append(ids, *a.CoverMediaID)
	}
	mediaRows, err := loadMediaByIDs(ctx, src.Media, ids)
	if err != nil {
		return nil, err
	}
	localUser := ""
	localOrg := ""
	if len(articles) > 0 {
		localUser = articles[0].AuthorUserID.String()
		if articles[0].AuthorOrgID != nil {
			localOrg = articles[0].AuthorOrgID.String()
		}
	}
	return &ExportManifest{
		Version:           1,
		Brand:             epicaBrand,
		ArticleCount:      len(articles),
		MediaCount:        len(mediaRows),
		LocalAuthorUserID: localUser,
		LocalAuthorOrgID:  localOrg,
		Articles:          articles,
		Media:             mediaRows,
	}, nil
}

func printDryRun(r DryRunReport) {
	status := "SAFE"
	if !r.Safe {
		status = "BLOCKED"
	}
	log.Printf("=== EPICA dry-run: %s ===", status)
	log.Printf("brand=%s mapping_ok=%v", r.Brand, r.MappingOK)
	for _, t := range r.Tables {
		log.Printf("table %-34s source=%d create=%d exists=%d conflicts=%d missing_deps=%d",
			t.Table, t.SourceRows, t.WouldCreate, t.AlreadyExists, t.Conflicts, t.MissingDeps)
		for _, s := range t.ConflictSamples {
			log.Printf("  conflict: %s", s)
		}
		for _, s := range t.MissingSamples {
			log.Printf("  missing: %s", s)
		}
	}
	log.Printf("files total=%d copy=%d present=%d conflicts=%d missing_source=%d",
		r.Files.Total, r.Files.WouldCopy, r.Files.AlreadyPresent, r.Files.Conflicts, r.Files.MissingSource)
	for _, s := range r.MappingErrors {
		log.Printf("mapping: %s", s)
	}
	for _, s := range r.BlockedReasons {
		log.Printf("blocked: %s", s)
	}
}

func mustUUID(s string) uuid.UUID {
	id, err := uuid.Parse(s)
	if err != nil {
		return uuid.Nil
	}
	return id
}

func appendSample(dst []string, msg string) []string {
	if len(dst) >= 5 {
		return dst
	}
	return append(dst, msg)
}
