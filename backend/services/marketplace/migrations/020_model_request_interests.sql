-- MODEL-01: explicit client interest in a published model_request.
-- Interest ≠ response and does not consume capacity.
-- No backfill from client_model_preferences.willing.
--
-- Rollback:
--   DROP TABLE IF EXISTS model_request_interests;

CREATE TABLE IF NOT EXISTS model_request_interests (
  user_id UUID NOT NULL,
  request_id UUID NOT NULL REFERENCES model_requests(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id)
);

CREATE INDEX IF NOT EXISTS model_request_interests_user_idx
  ON model_request_interests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS model_request_interests_request_idx
  ON model_request_interests (request_id);
