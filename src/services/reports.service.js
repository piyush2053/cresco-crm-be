import ExcelJS from "exceljs";
import { query } from "../db.js";
import { config, } from "../config.js";
import { sendMail } from "../utils.js";

export const ReportsService = {
  async dashboard() {
    const enquiryCount = await query("SELECT count(*) FROM enquiries");
    const buyerCount = await query("SELECT count(*) FROM buyers");
    const supplierCount = await query("SELECT count(*) FROM suppliers");
    const activeDeals = await query("SELECT count(*) FROM enquiries WHERE status IN ('Quoted','In Progress','Won')");
    return {
      totalEnquiries: enquiryCount.rows[0].count,
      totalBuyers: buyerCount.rows[0].count,
      totalSuppliers: supplierCount.rows[0].count,
      activeDeals: activeDeals.rows[0].count,
    };
  },

  async createWeeklyReport() {
    const report = await query(
      `SELECT e.enquiry_no, b.group_name AS buyer, s.group_name AS supplier, e.chemical, e.quantity, e.price, e.status, e.priority, e.expected_closing_date
       FROM enquiries e
       LEFT JOIN buyers b ON b.id = e.buyer_id
       LEFT JOIN suppliers s ON s.id = e.supplier_id
       ORDER BY e.created_at DESC LIMIT 100`
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Weekly Enquiry Report");
    sheet.columns = [
      { header: "Enquiry No", key: "enquiry_no", width: 20 },
      { header: "Buyer", key: "buyer", width: 25 },
      { header: "Supplier", key: "supplier", width: 25 },
      { header: "Chemical", key: "chemical", width: 25 },
      { header: "Quantity", key: "quantity", width: 15 },
      { header: "Price", key: "price", width: 15 },
      { header: "Status", key: "status", width: 20 },
      { header: "Priority", key: "priority", width: 15 },
      { header: "Expected Close", key: "expected_closing_date", width: 20 },
    ];

    report.rows.forEach((row) => {
      sheet.addRow({
        enquiry_no: row.enquiry_no,
        buyer: row.buyer,
        supplier: row.supplier,
        chemical: row.chemical,
        quantity: row.quantity,
        price: row.price,
        status: row.status,
        priority: row.priority,
        expected_closing_date: row.expected_closing_date ? new Date(row.expected_closing_date).toISOString().slice(0, 10) : "",
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    await this.sendWeeklyReportToAdmin(buffer);
    return buffer;
  },

  async sendWeeklyReportToAdmin(buffer) {
    const admins = await query("SELECT email FROM users WHERE is_admin = TRUE AND email_verified = TRUE");
    if (admins.rowCount === 0) return;
    for (const row of admins.rows) {
      await sendMail(row.email, "Cresco CRM Weekly Report", `<p>Attached is the weekly CRM report.</p>`, );
    }
  },
};
