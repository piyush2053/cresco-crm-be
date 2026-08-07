BEGIN;
CREATE INDEX IF NOT EXISTS idx_user_crm_sessions_login_at ON user_crm_sessions(login_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_started_at ON scheduled_job_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_bi_report_runs_started_at ON bi_report_runs(started_at);
COMMIT;
