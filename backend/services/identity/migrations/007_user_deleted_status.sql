-- Self-service account deletion uses status=deleted (soft delete + anonymization).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'blocked', 'deleted'));
