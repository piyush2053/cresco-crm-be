import ExcelJS from "exceljs";
import { query } from "../db.js";
import { safeJson } from "../utils.js";

const HEADER_MAP = [
  "company_name",
  "gst_number",
  "contact_name",
  "email",
  "phone",
  "country",
  "address",
  "currency",
  "is_active",
];

export const UploadsService = {
  async processSupplierExcel(filename, buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new Error("Uploaded file has no worksheet.");
    }

    const rows = [];
    sheet.eachRow((row, index) => {
      if (index === 1) return;
      const cells = row.values;
      const data = {};
      HEADER_MAP.forEach((key, idx) => {
        data[key] = cells[idx + 1] ?? null;
      });
      rows.push(data);
    });

    const insertResult = await query(
      "INSERT INTO uploads (filename, status, inserted_count) VALUES ($1, $2, $3) RETURNING id",
      [filename, "completed", rows.length]
    );

    for (const row of rows) {
      await query(
        `INSERT INTO suppliers (group_name, gst_number, primary_contact_name, email, primary_contact_number, country, registered_address, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          row.company_name,
          row.gst_number,
          row.contact_name,
          row.email,
          row.phone,
          row.country,
          row.address,
          row.is_active === "false" ? false : row.is_active,
        ]
      );
    }

    return { id: insertResult.rows[0].id, filename, status: "completed", inserted_count: rows.length };
  },

  async status() {
    const result = await query("SELECT * FROM uploads ORDER BY uploaded_at DESC LIMIT 10");
    return result.rows.map((row) => safeJson(row));
  },
};
