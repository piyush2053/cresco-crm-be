BEGIN;
CREATE TABLE IF NOT EXISTS notifications(
 id BIGSERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL,message TEXT NOT NULL,type TEXT NOT NULL DEFAULT 'info',link TEXT,
 is_read BOOLEAN NOT NULL DEFAULT FALSE,metadata JSONB NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id,is_read,created_at DESC);
CREATE TABLE IF NOT EXISTS scheduled_job_runs(
 id BIGSERIAL PRIMARY KEY,job_name TEXT NOT NULL,status TEXT NOT NULL,details TEXT,started_at TIMESTAMPTZ DEFAULT now(),completed_at TIMESTAMPTZ
);
UPDATE roles SET permissions=jsonb_set(jsonb_set(COALESCE(permissions,'{}'::jsonb),'{modules}',COALESCE(permissions->'modules','{}'::jsonb),true),'{modules,notifications}','true',true);
COMMIT;
