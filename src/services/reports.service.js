import ExcelJS from "exceljs";
import { query } from "../db.js";
import { config, } from "../config.js";
import { sendMail } from "../utils.js";

export const ReportsService = {
  async dashboard() {
    const [buyers, suppliers, orders, logistics, finance, recentOrders, deliveries, expiringPrices] = await Promise.all([
      query("SELECT count(*) total,count(*) FILTER(WHERE order_count>0) customers FROM buyers"),
      query("SELECT count(*) total FROM suppliers WHERE is_active"),
      query("SELECT count(*) total,COALESCE(sum(total_order_value),0) value,count(*) FILTER(WHERE status NOT IN ('Completed','Cancelled')) active FROM orders WHERE deleted_at IS NULL"),
      query("SELECT count(*) shipments,COALESCE(sum(total_logistics_cost),0) spend FROM logistics_cost_register"),
      query("SELECT COALESCE(sum(amount) FILTER(WHERE payment_status<>'Paid'),0) outstanding,count(*) FILTER(WHERE payment_status<>'Paid' AND due_date<CURRENT_DATE) overdue FROM finance"),
      query("SELECT o.id,o.order_number,o.product_category,o.grade,o.quantity_kg,o.status,o.order_date,b.group_name buyer_name FROM orders o JOIN buyers b ON b.id=o.buyer_id WHERE o.deleted_at IS NULL ORDER BY o.created_at DESC LIMIT 8"),
      query("SELECT count(*) due FROM orders WHERE deleted_at IS NULL AND status NOT IN ('Completed','Cancelled') AND expected_delivery_date<=CURRENT_DATE+7"),
      query("SELECT count(*) expiring FROM supplier_grade_prices WHERE is_active AND expires_at BETWEEN now() AND now()+interval '12 hours'")
    ]);
    return {
      totalBuyers:+buyers.rows[0].total, customers:+buyers.rows[0].customers,
      totalSuppliers:+suppliers.rows[0].total,totalOrders:+orders.rows[0].total,activeOrders:+orders.rows[0].active,
      orderValue:+orders.rows[0].value,logisticsShipments:+logistics.rows[0].shipments,logisticsSpend:+logistics.rows[0].spend,
      financeOutstanding:+finance.rows[0].outstanding,overduePayments:+finance.rows[0].overdue,
      deliveriesDue:+deliveries.rows[0].due,pricesExpiring:+expiringPrices.rows[0].expiring,recentOrders:recentOrders.rows
    };
  },

  async createWeeklyReport() {
    const report = await query(
      `SELECT o.order_number,b.group_name buyer,s.group_name supplier,o.product_category,o.grade,o.quantity_kg,o.total_order_value,o.gross_margin,o.status,o.expected_delivery_date
       FROM orders o JOIN buyers b ON b.id=o.buyer_id LEFT JOIN suppliers s ON s.id=o.supplier_id
       WHERE o.deleted_at IS NULL ORDER BY o.created_at DESC LIMIT 100`
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Weekly Order Report");
    sheet.columns = [
      { header: "Order No", key: "order_number", width: 20 },
      { header: "Buyer", key: "buyer", width: 25 },
      { header: "Supplier", key: "supplier", width: 25 },
      { header: "Product", key: "product_category", width: 25 },
      { header: "Grade", key: "grade", width: 18 },
      { header: "Quantity Kg", key: "quantity_kg", width: 15 },
      { header: "Order Value", key: "total_order_value", width: 15 },
      { header: "Gross Margin", key: "gross_margin", width: 15 },
      { header: "Status", key: "status", width: 20 },
      { header: "Expected Delivery", key: "expected_delivery_date", width: 20 },
    ];

    report.rows.forEach((row) => {
      sheet.addRow({
        order_number: row.order_number,
        buyer: row.buyer,
        supplier: row.supplier,
        product_category: row.product_category, grade: row.grade, quantity_kg: row.quantity_kg,
        total_order_value: row.total_order_value, gross_margin: row.gross_margin,
        status: row.status,
        expected_delivery_date: row.expected_delivery_date ? new Date(row.expected_delivery_date).toISOString().slice(0, 10) : "",
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
      await sendMail(row.email, "Cresco CRM Weekly Order Report", `<p>Attached is the weekly order report.</p>`, );
    }
  },
};
