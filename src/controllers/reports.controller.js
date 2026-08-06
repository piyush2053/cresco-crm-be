
import { ReportsService } from "../services/reports.service.js";

export const ReportsController = {
  async weeklyReport(req, res) {
    const buffer = await ReportsService.createWeeklyReport();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=weekly-report.xlsx");
    return res.send(buffer);
  },

  async dashboard(req, res) {
    const data = await ReportsService.dashboard();
    return res.json(data);
  },
};
