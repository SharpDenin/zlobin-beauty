-- Branch close jobs: idempotent orchestration of soft branch deactivation.
-- Rollback:
--   DROP TABLE IF EXISTS branch_close_jobs;

CREATE TABLE IF NOT EXISTS branch_close_jobs (
  id UUID PRIMARY KEY,
  branch_id UUID NOT NULL REFERENCES branches(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  actor_user_id UUID NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('running', 'completed', 'failed', 'blocked')),
  contact_phone TEXT NOT NULL DEFAULT '',
  contact_source TEXT NOT NULL DEFAULT '',
  future_appointments INT NOT NULL DEFAULT 0,
  masters_affected INT NOT NULL DEFAULT 0,
  last_active_branch BOOLEAN NOT NULL DEFAULT FALSE,
  org_unpublished BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT NOT NULL DEFAULT '',
  blockers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS branch_close_jobs_one_running
  ON branch_close_jobs (branch_id)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS branch_close_jobs_branch_idx
  ON branch_close_jobs (branch_id, created_at DESC);
