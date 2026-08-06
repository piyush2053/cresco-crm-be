
import { ReportsService } from "../services/reports.service.js";
import { BIService } from "../services/bi.service.js";

export const ReportsController = {
  async userTime(req, res) {
    return res.json(await ReportsService.userTime(req.query.month, req.query.user_id, req.query.start_date, req.query.end_date));
  },
  async userTimeSessions(req, res) {
    return res.json(await ReportsService.userTimeSessions(req.query.month, req.query.user_id, req.query.start_date, req.query.end_date));
  },
  async userTimeDaily(req, res) {
    return res.json(await ReportsService.userTimeDaily(req.query.month, req.query.user_id, req.query.start_date, req.query.end_date));
  },
  async monthlyReport(req, res) {
    const buffer = await ReportsService.createMonthlyReport();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=monthly-report.xlsx");
    return res.send(buffer);
  },

  async dashboard(req, res) {
    const data = await ReportsService.dashboard();
    return res.json(data);
  },
  async catalog(req,res){res.json(BIService.catalog())},
  async reports(req,res){res.json(await BIService.reports())},
  async saveReport(req,res){res.status(req.params.id?200:201).json(await BIService.saveReport(req.params.id?+req.params.id:null,req.body,req.user.id))},
  async run(req,res){res.json(await BIService.run(req.body))},
  async export(req,res){const out=await BIService.export(req.body,req.params.format);res.setHeader("Content-Type",out.type);res.setHeader("Content-Disposition",`attachment; filename=bi-report.${out.ext}`);res.send(out.buffer)},
  async dashboards(req,res){res.json(await BIService.dashboards())},
  async createDashboard(req,res){res.status(201).json(await BIService.saveDashboard(req.body,req.user.id))},
  async addWidget(req,res){res.status(201).json(await BIService.addWidget(+req.params.id,req.body))},
  async reorder(req,res){res.json(await BIService.reorder(+req.params.id,req.body.widgets||[]))},
  async schedules(req,res){res.json(await BIService.schedules())},
  async createSchedule(req,res){res.status(201).json(await BIService.saveSchedule(req.body,req.user.id))},
};
