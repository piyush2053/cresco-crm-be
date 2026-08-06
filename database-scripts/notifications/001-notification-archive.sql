BEGIN;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_notifications_active_user ON notifications(user_id,created_at DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_archive_user ON notifications(user_id,archived_at DESC) WHERE archived_at IS NOT NULL;
COMMIT;
