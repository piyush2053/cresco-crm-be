import { query } from "../db.js";
import { NotificationsService } from "./notifications.service.js";

export const MaintenanceService = {
  async runRetention() {
    const stale = await query("UPDATE user_crm_sessions SET logout_at=last_seen_at WHERE logout_at IS NULL AND last_seen_at<now()-interval '12 hours'");
    const sessions = await query("DELETE FROM user_crm_sessions WHERE login_at<now()-interval '25 months'");
    const jobs = await query("DELETE FROM scheduled_job_runs WHERE started_at<now()-interval '12 months'");
    const reportRuns = await query("DELETE FROM bi_report_runs WHERE started_at<now()-interval '12 months'");
    await query("VACUUM (ANALYZE) user_crm_sessions");
    await query("VACUUM (ANALYZE) scheduled_job_runs");
    await query("VACUUM (ANALYZE) bi_report_runs");
    const result={staleSessionsClosed:stale.rowCount,oldSessionsDeleted:sessions.rowCount,oldJobRunsDeleted:jobs.rowCount,oldReportRunsDeleted:reportRuns.rowCount};
    console.log("Bi-monthly database retention completed:",result);
    await NotificationsService.notifyAdmins("Database housekeeping completed",`Closed ${result.staleSessionsClosed} stale sessions and removed ${result.oldSessionsDeleted+result.oldJobRunsDeleted+result.oldReportRunsDeleted} expired technical records. Business and audit history was retained.`,"success","/monitoring");
    return result;
  }
};
