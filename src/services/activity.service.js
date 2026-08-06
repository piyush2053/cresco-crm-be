import { query } from "../db.js";

function range(month, startDate, endDate) {
  const fallback = /^\d{4}-\d{2}$/.test(month || "") ? month : new Date().toISOString().slice(0, 7);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(startDate || "") ? startDate : `${fallback}-01`;
  const base = new Date(`${fallback}-01T00:00:00Z`);
  const monthEnd = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const end = /^\d{4}-\d{2}-\d{2}$/.test(endDate || "") ? endDate : monthEnd;
  if (start > end) throw Object.assign(new Error("From Date cannot be after To Date."), { status: 400 });
  if ((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000 > 366) throw Object.assign(new Error("Please select a date range of 12 months or less."), { status: 400 });
  return { start, end };
}

export const ActivityService = {
  async start(userId) {
    const result = await query(
      "INSERT INTO user_crm_sessions(user_id) VALUES($1) RETURNING id",
      [userId]
    );
    return result.rows[0].id;
  },

  async heartbeat(userId, sessionId, close = false) {
    if (!sessionId) return;
    await query(
      `UPDATE user_crm_sessions
       SET active_seconds = active_seconds + GREATEST(0, LEAST(300, EXTRACT(EPOCH FROM (now() - last_seen_at))::int)),
           last_seen_at = now(),
           logout_at = CASE WHEN $3 THEN now() ELSE logout_at END
       WHERE id = $1 AND user_id = $2 AND logout_at IS NULL`,
      [sessionId, userId, close]
    );
  },

  async monthly(month, userId, startDate, endDate) {
    const { start, end } = range(month, startDate, endDate);
    const result = await query(
      `SELECT u.id user_id, u.name, u.email, r.name role_name,
              count(s.id)::int session_count,
              COALESCE(sum(s.active_seconds), 0)::bigint active_seconds,
              min(s.login_at) first_login_at, max(s.last_seen_at) last_seen_at
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN user_crm_sessions s ON s.user_id = u.id
         AND s.login_at >= $1::date AND s.login_at < ($2::date + interval '1 day')
       WHERE u.is_active AND ($3::bigint IS NULL OR u.id = $3)
       GROUP BY u.id, u.name, u.email, r.name
       ORDER BY active_seconds DESC, u.name`,
      [start, end, userId || null]
    );
    return result.rows;
  },

  async sessions(month, userId, startDate, endDate) {
    const { start, end } = range(month, startDate, endDate);
    const result = await query(
      `SELECT s.id, s.user_id, u.name, u.email, s.login_at, s.last_seen_at, s.logout_at, s.active_seconds
       FROM user_crm_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.login_at >= $1::date AND s.login_at < ($2::date + interval '1 day')
         AND ($3::bigint IS NULL OR s.user_id = $3)
       ORDER BY s.login_at DESC
       LIMIT 1000`,
      [start, end, userId || null]
    );
    return result.rows;
  },

  async daily(month, userId, startDate, endDate) {
    const { start, end } = range(month, startDate, endDate);
    const result = await query(
      `SELECT s.login_at::date activity_date, count(DISTINCT s.user_id)::int user_count,
              count(*)::int session_count, COALESCE(sum(s.active_seconds), 0)::bigint active_seconds
       FROM user_crm_sessions s
       WHERE s.login_at >= $1::date AND s.login_at < ($2::date + interval '1 day')
         AND ($3::bigint IS NULL OR s.user_id = $3)
       GROUP BY s.login_at::date
       ORDER BY activity_date DESC`,
      [start, end, userId || null]
    );
    return result.rows;
  }
};
