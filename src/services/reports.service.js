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
      query("SELECT COALESCE(sum(outstanding),0) outstanding,count(*) FILTER(WHERE outstanding>0 AND due_date<CURRENT_DATE) overdue FROM finance_receivables_view"),
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

  async createMonthlyReport() {
    const [buyers,suppliers,orders] = await Promise.all([
      query(`SELECT b.group_name,b.pan,b.gst_slab,b.state,b.group_tag,b.lead_manager,b.lifecycle_status,
        c.name primary_contact,c.mobile_number,c.email_address,b.created_at FROM buyers b LEFT JOIN buyer_contacts c ON c.buyer_id=b.id AND c.is_primary ORDER BY b.created_at DESC`),
      query(`SELECT s.group_name,s.pan,s.gst_number,s.primary_contact_name,s.primary_contact_number,s.email,s.country,s.supplier_tag,s.is_active,
        count(w.id)::int warehouses,s.created_at FROM suppliers s LEFT JOIN supplier_warehouses w ON w.supplier_id=s.id GROUP BY s.id ORDER BY s.created_at DESC`),
      query(`SELECT o.order_number,b.group_name buyer,s.group_name supplier,o.product_category,o.grade,o.quantity_kg,o.sale_price_per_kg,o.purchase_price_per_kg,o.freight_per_kg,o.total_order_value,o.gross_margin,o.status,o.order_date,o.expected_delivery_date
       FROM orders o JOIN buyers b ON b.id=o.buyer_id LEFT JOIN suppliers s ON s.id=o.supplier_id
       WHERE o.deleted_at IS NULL ORDER BY o.created_at DESC`)
    ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator="Cresco CRM"; workbook.created=new Date();
    const buyerSheet=workbook.addWorksheet("Buyers");
    buyerSheet.columns=[
      {header:"Group Name",key:"group_name",width:28},{header:"PAN",key:"pan",width:15},{header:"GST Slab",key:"gst_slab",width:12},
      {header:"State",key:"state",width:18},{header:"Group Tag",key:"group_tag",width:18},{header:"Lead Manager",key:"lead_manager",width:20},
      {header:"Lifecycle",key:"lifecycle_status",width:20},{header:"Primary Contact",key:"primary_contact",width:24},{header:"Mobile",key:"mobile_number",width:16},
      {header:"Email",key:"email_address",width:28},{header:"Created At",key:"created_at",width:22}
    ];buyerSheet.addRows(buyers.rows);
    const supplierSheet=workbook.addWorksheet("Suppliers");supplierSheet.columns=[
      {header:"Supplier Group",key:"group_name",width:28},{header:"PAN",key:"pan",width:15},{header:"GST",key:"gst_number",width:18},
      {header:"Primary Contact",key:"primary_contact_name",width:24},{header:"Mobile",key:"primary_contact_number",width:16},{header:"Email",key:"email",width:28},
      {header:"Country",key:"country",width:16},{header:"Tag",key:"supplier_tag",width:18},{header:"Warehouses",key:"warehouses",width:12},{header:"Active",key:"is_active",width:10},{header:"Created At",key:"created_at",width:22}
    ];supplierSheet.addRows(suppliers.rows);
    const sheet = workbook.addWorksheet("Orders"); sheet.columns = [
      { header: "Order No", key: "order_number", width: 20 },
      { header: "Buyer", key: "buyer", width: 25 },
      { header: "Supplier", key: "supplier", width: 25 },
      { header: "Product", key: "product_category", width: 25 },
      { header: "Grade", key: "grade", width: 18 },
      { header: "Quantity Kg", key: "quantity_kg", width: 15 },
      { header: "Order Value", key: "total_order_value", width: 15 },
      { header: "Gross Margin", key: "gross_margin", width: 15 },
      { header: "Sale ₹/Kg", key: "sale_price_per_kg", width: 14 },{ header: "Purchase ₹/Kg", key: "purchase_price_per_kg", width: 16 },{ header: "Freight ₹/Kg", key: "freight_per_kg", width: 14 },
      { header: "Status", key: "status", width: 20 },
      { header: "Order Date", key: "order_date", width: 16 },
      { header: "Expected Delivery", key: "expected_delivery_date", width: 20 },
    ];

    orders.rows.forEach((row) => {
      sheet.addRow({
        order_number: row.order_number,
        buyer: row.buyer,
        supplier: row.supplier,
        product_category: row.product_category, grade: row.grade, quantity_kg: row.quantity_kg,
        total_order_value: row.total_order_value, gross_margin: row.gross_margin,
        sale_price_per_kg:row.sale_price_per_kg,purchase_price_per_kg:row.purchase_price_per_kg,freight_per_kg:row.freight_per_kg,order_date:row.order_date,
        status: row.status,
        expected_delivery_date: row.expected_delivery_date ? new Date(row.expected_delivery_date).toISOString().slice(0, 10) : "",
      });
    });
    for(const ws of workbook.worksheets){ws.views=[{state:"frozen",ySplit:1}];ws.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};ws.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF0F4C5C"}};ws.autoFilter={from:{row:1,column:1},to:{row:1,column:ws.columnCount}}}

    return workbook.xlsx.writeBuffer();
  },

  async sendMonthlyReportToAdmin(buffer) {
    const admins = await query("SELECT email FROM users WHERE is_admin = TRUE AND email_verified = TRUE");
    if (admins.rowCount === 0) return;
    for (const row of admins.rows) {
      await sendMail(row.email,"Cresco CRM Monthly Business Report",`<p>Hello,</p><p>Attached is the monthly CRM report containing complete Buyer, Supplier and Order data.</p><p>This report was generated in memory and is not stored on the server.</p>`,{attachments:[{filename:`cresco-monthly-report-${new Date().toISOString().slice(0,10)}.xlsx`,content:buffer,contentType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}]});
    }
  },
};
