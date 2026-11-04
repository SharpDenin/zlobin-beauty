-- DIAG-01: hair consultations between client and master (peer workflow).
-- No backfill; no FK to identity/marketplace users (same pattern as other client tables).
--
-- Rollback:
--   DROP TABLE IF EXISTS hair_consultation_media;
--   DROP TABLE IF EXISTS hair_consultation_events;
--   DROP TABLE IF EXISTS hair_consultation_versions;
--   DROP TABLE IF EXISTS hair_consultations;

CREATE TABLE IF NOT EXISTS hair_consultations (
  id UUID PRIMARY KEY,
  client_user_id UUID NOT NULL,
  master_user_id UUID NOT NULL,
  organization_id UUID,
  client_card_id UUID REFERENCES client_cards(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'awaiting_master', 'in_progress', 'awaiting_client', 'approved', 'closed')),
  current_version_id UUID,
  conversation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (client_user_id <> master_user_id)
);

CREATE INDEX IF NOT EXISTS hair_consultations_client_idx
  ON hair_consultations (client_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS hair_consultations_master_idx
  ON hair_consultations (master_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS hair_consultations_status_idx
  ON hair_consultations (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS hair_consultation_versions (
  id UUID PRIMARY KEY,
  consultation_id UUID NOT NULL REFERENCES hair_consultations(id) ON DELETE CASCADE,
  version_no INT NOT NULL CHECK (version_no > 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'in_review', 'sent', 'changes_requested', 'approved', 'superseded')),
  client_questionnaire JSONB NOT NULL DEFAULT '{}'::jsonb,
  master_assessment JSONB NOT NULL DEFAULT '{}'::jsonb,
  plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_comment TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL,
  submitted_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  immutable_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (consultation_id, version_no)
);

CREATE INDEX IF NOT EXISTS hair_consultation_versions_consult_idx
  ON hair_consultation_versions (consultation_id, version_no DESC);

ALTER TABLE hair_consultations
  DROP CONSTRAINT IF EXISTS hair_consultations_current_version_fk;
ALTER TABLE hair_consultations
  ADD CONSTRAINT hair_consultations_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES hair_consultation_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS hair_consultation_events (
  id UUID PRIMARY KEY,
  consultation_id UUID NOT NULL REFERENCES hair_consultations(id) ON DELETE CASCADE,
  version_id UUID REFERENCES hair_consultation_versions(id) ON DELETE SET NULL,
  actor_user_id UUID NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL DEFAULT '',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hair_consultation_events_consult_idx
  ON hair_consultation_events (consultation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS hair_consultation_media (
  id UUID PRIMARY KEY,
  version_id UUID NOT NULL REFERENCES hair_consultation_versions(id) ON DELETE CASCADE,
  media_id UUID NOT NULL,
  slot TEXT NOT NULL
    CHECK (slot IN ('overview', 'roots', 'length', 'ends', 'strand_a4', 'reference')),
  uploaded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (version_id, media_id)
);

CREATE INDEX IF NOT EXISTS hair_consultation_media_media_idx
  ON hair_consultation_media (media_id);
CREATE INDEX IF NOT EXISTS hair_consultation_media_version_idx
  ON hair_consultation_media (version_id, slot);
