package main

import (
	"time"

	"github.com/google/uuid"
)

// Mapping remaps local demo author/org IDs onto existing production entities.
// Local users/orgs are never inserted into production.
type Mapping struct {
	Users         map[string]string `json:"users"`
	Organizations map[string]string `json:"organizations"`
}

type ArticleRow struct {
	ID                  uuid.UUID  `json:"id"`
	Title               string     `json:"title"`
	Category            string     `json:"category"`
	Content             string     `json:"content"`
	AuthorUserID        uuid.UUID  `json:"author_user_id"`
	AuthorOrgID         *uuid.UUID `json:"author_org_id"`
	AuthorName          string     `json:"author_name"`
	Published           bool       `json:"published"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
	Brand               string     `json:"brand"`
	ProductID           *uuid.UUID `json:"product_id"`
	PublishedAt         *time.Time `json:"published_at"`
	ContentFormat       string     `json:"content_format"`
	CoverMediaID        *uuid.UUID `json:"cover_media_id"`
	ReadingTimeMinutes  int        `json:"reading_time_minutes"`
	Status              string     `json:"status"`
	ViewCount           int        `json:"view_count"`
	ArchivedAt          *time.Time `json:"archived_at"`
}

type MediaRow struct {
	ID           uuid.UUID `json:"id"`
	OwnerUserID  uuid.UUID `json:"owner_user_id"`
	Purpose      string    `json:"purpose"`
	ContentType  string    `json:"content_type"`
	SizeBytes    int64     `json:"size_bytes"`
	SHA256       string    `json:"sha256"`
	ObjectKey    string    `json:"object_key"`
	Bucket       string    `json:"bucket"`
	OriginalName string    `json:"original_name"`
	CreatedAt    time.Time `json:"created_at"`
}

type ExportManifest struct {
	Version     int          `json:"version"`
	ExportedAt  time.Time    `json:"exported_at"`
	Brand       string       `json:"brand"`
	SourceNote  string       `json:"source_note"`
	ArticleCount int         `json:"article_count"`
	MediaCount  int          `json:"media_count"`
	LocalAuthorUserID string `json:"local_author_user_id"`
	LocalAuthorOrgID  string `json:"local_author_org_id"`
	Articles    []ArticleRow `json:"articles"`
	Media       []MediaRow   `json:"media"`
}

type RowOutcome string

const (
	OutcomeCreate  RowOutcome = "create"
	OutcomeExists  RowOutcome = "exists"
	OutcomeConflict RowOutcome = "conflict"
	OutcomeBlocked RowOutcome = "blocked"
)

type TableReport struct {
	Table           string `json:"table"`
	SourceRows      int    `json:"source_rows"`
	WouldCreate     int    `json:"would_create"`
	AlreadyExists   int    `json:"already_exists"`
	Conflicts       int    `json:"conflicts"`
	MissingDeps     int    `json:"missing_deps"`
	ConflictSamples []string `json:"conflict_samples,omitempty"`
	MissingSamples  []string `json:"missing_samples,omitempty"`
}

type FileReport struct {
	ObjectKey   string `json:"object_key"`
	SizeBytes   int64  `json:"size_bytes"`
	LocalPath   string `json:"local_path,omitempty"`
	Outcome     string `json:"outcome"` // copy | exists | conflict | missing_source
	Detail      string `json:"detail,omitempty"`
}

type DryRunReport struct {
	Safe            bool          `json:"safe"`
	Brand           string        `json:"brand"`
	MappingOK       bool          `json:"mapping_ok"`
	MappingErrors   []string      `json:"mapping_errors,omitempty"`
	Tables          []TableReport `json:"tables"`
	Files           FileSummary   `json:"files"`
	BlockedReasons  []string      `json:"blocked_reasons,omitempty"`
	Notes           []string      `json:"notes,omitempty"`
}

type FileSummary struct {
	Total          int `json:"total"`
	WouldCopy      int `json:"would_copy"`
	AlreadyPresent int `json:"already_present"`
	Conflicts      int `json:"conflicts"`
	MissingSource  int `json:"missing_source"`
	Samples        []FileReport `json:"samples,omitempty"`
}
