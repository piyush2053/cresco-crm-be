BEGIN;

CREATE TABLE IF NOT EXISTS user_crm_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  logout_at TIMESTAMPTZ,
  active_seconds INTEGER NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_crm_sessions_user_month
  ON user_crm_sessions (user_id, login_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_crm_sessions_open
  ON user_crm_sessions (id, user_id)
  WHERE logout_at IS NULL;

COMMIT;
