import pg from "pg";

// Intentionally limited to transactional tables. Buyer/supplier profiles,
// their master data, settings, UBL variables, logistics masters and users are
// never part of this allowlist.
const TRANSACTION_TABLES = [
  "enquiries",
  "followups",
  "orders",
  "sales_transactions",
  "sales_transaction_products",
  "sales_product_charges",
  "sales_quote_revisions",
  "sales_quote_revision_lines",
  "sales_communications",
  "sales_stage_history",
  "sales_documents",
  "sales_quote_overrides",
  "logistics_shipments",
  "logistics_cost_register",
  "logistics_transactions",
  "logistics_transaction_costs",
  "logistics_audit_history",
  "supplier_procurement_transactions",
  "supplier_procurement_audit",
  "finance_commercial_records",
  "finance_receivable_invoices",
  "finance_payable_invoices",
  "finance_payable_order_links",
  "finance_customer_payments",
  "finance_receipt_allocations",
  "finance_supplier_payments",
  "finance_payment_allocations",
  "finance_documents",
  "finance_timeline",
  "finance_approval_requests",
  "delayed_payment_accounts",
  "delayed_payment_accruals",
  "delayed_payment_debit_notes",
  "delayed_payment_audit",
];

const identifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const tableRef = (name) => `public.${identifier(name)}`;

function parseIds(name) {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (!arg) return [];
  const values = arg.slice(name.length + 3).split(",").map((value) => value.trim());
  if (values.some((value) => !/^\d+$/.test(value) || BigInt(value) < 1n)) {
    throw new Error(`--${name} must be a comma-separated list of positive integer IDs.`);
  }
  return [...new Set(values)];
}

function getOptions() {
  const buyerIds = parseIds("buyer-ids");
  const supplierIds = parseIds("supplier-ids");
  if (!buyerIds.length && !supplierIds.length) {
    throw new Error("Provide explicit --buyer-ids and/or --supplier-ids. No global cleanup mode exists.");
  }
  const apply = process.argv.includes("--apply");
  const database = process.env.DB_NAME || "cresco_local";
  if (apply && process.argv.find((value) => value.startsWith("--confirm="))?.slice(10) !== `DELETE_LINKED_TEST_TRANSACTIONS_FROM_${database}`) {
    throw new Error(`Apply requires --confirm=DELETE_LINKED_TEST_TRANSACTIONS_FROM_${database}`);
  }
  return { buyerIds, supplierIds, apply, database };
}

function buildConnectionOptions(database) {
  return {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || undefined,
    database,
    ssl: String(process.env.DB_SSL || "false").toLowerCase() === "true"
      ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").toLowerCase() !== "false" }
      : undefined,
    application_name: "cresco-post-testing-data-cleanup",
  };
}

async function getSchema(client) {
  const [tableResult, columnResult, fkResult] = await Promise.all([
    client.query(
      "SELECT c.relname AS table_name, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])",
      [TRANSACTION_TABLES],
    ),
    client.query(
      "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[])",
      [TRANSACTION_TABLES],
    ),
    client.query(`
      SELECT con.conname, child.relname AS child_table, parent.relname AS parent_table,
             con.confdeltype AS delete_action,
             array_agg(child_col.attname ORDER BY key_part.ordinality) AS child_columns,
             array_agg(parent_col.attname ORDER BY key_part.ordinality) AS parent_columns
      FROM pg_constraint con
      JOIN pg_class child ON child.oid=con.conrelid
      JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace
      JOIN pg_class parent ON parent.oid=con.confrelid
      JOIN pg_namespace parent_ns ON parent_ns.oid=parent.relnamespace
      CROSS JOIN LATERAL unnest(con.conkey,con.confkey) WITH ORDINALITY AS key_part(child_attnum,parent_attnum,ordinality)
      JOIN pg_attribute child_col ON child_col.attrelid=child.oid AND child_col.attnum=key_part.child_attnum
      JOIN pg_attribute parent_col ON parent_col.attrelid=parent.oid AND parent_col.attnum=key_part.parent_attnum
      WHERE con.contype='f' AND child_ns.nspname='public' AND parent_ns.nspname='public'
      GROUP BY con.conname,child.relname,parent.relname,con.confdeltype
    `),
  ]);

  const tables = new Map(tableResult.rows.map((row) => [row.table_name, row.relkind]));
  for (const [name, kind] of tables) {
    if (kind !== "r") throw new Error(`Refusing to clean non-ordinary table ${name} (relkind ${kind}).`);
  }
  const columns = new Map();
  for (const row of columnResult.rows) {
    if (!columns.has(row.table_name)) columns.set(row.table_name, new Set());
    columns.get(row.table_name).add(row.column_name);
  }
  const fks = fkResult.rows.map((fk) => ({
    ...fk,
    child_columns: fk.child_columns,
    parent_columns: fk.parent_columns,
  }));
  return { tables, columns, fks };
}

async function seedDirectRecords(client, schema, buyerIds, supplierIds) {
  for (const table of schema.tables.keys()) {
    const columns = schema.columns.get(table) || new Set();
    const clauses = [];
    const values = [];
    if (buyerIds.length && columns.has("buyer_id")) {
      values.push(buyerIds);
      clauses.push(`${identifier("buyer_id")} = ANY($${values.length}::bigint[])`);
    }
    if (supplierIds.length && columns.has("supplier_id")) {
      values.push(supplierIds);
      clauses.push(`${identifier("supplier_id")} = ANY($${values.length}::bigint[])`);
    }
    if (!clauses.length) continue;
    await client.query(
      `INSERT INTO cleanup_targets(table_name,row_tid) SELECT $${values.length + 1},t.ctid FROM ${tableRef(table)} t WHERE ${clauses.join(" OR ")} ON CONFLICT DO NOTHING`,
      [...values, table],
    );
  }
}

async function expandRelatedRecords(client, schema) {
  const edges = schema.fks.filter((fk) => schema.tables.has(fk.child_table) && schema.tables.has(fk.parent_table));
  let inserted;
  let rounds = 0;
  do {
    inserted = 0;
    for (const fk of edges) {
      const conditions = fk.child_columns.map((column, index) =>
        `child.${identifier(column)}=parent.${identifier(fk.parent_columns[index])}`,
      ).join(" AND ");
      const result = await client.query(
        `INSERT INTO cleanup_targets(table_name,row_tid)
         SELECT $1,child.ctid FROM ${tableRef(fk.child_table)} child
         JOIN ${tableRef(fk.parent_table)} parent ON ${conditions}
         JOIN cleanup_targets selected ON selected.table_name=$2 AND selected.row_tid=parent.ctid
         ON CONFLICT DO NOTHING`,
        [fk.child_table, fk.parent_table],
      );
      inserted += result.rowCount;
    }
    rounds += 1;
    if (rounds > schema.tables.size + 1) throw new Error("Related-record discovery did not converge; no data was deleted.");
  } while (inserted > 0);
}

async function getOutOfScopeReferences(client, schema) {
  const outsideEdges = schema.fks.filter((fk) => !schema.tables.has(fk.child_table) && schema.tables.has(fk.parent_table));
  const blockers = [];
  for (const fk of outsideEdges) {
    const conditions = fk.child_columns.map((column, index) =>
      `child.${identifier(column)}=parent.${identifier(fk.parent_columns[index])}`,
    ).join(" AND ");
    const result = await client.query(
      `SELECT 1 FROM ${tableRef(fk.child_table)} child
       JOIN ${tableRef(fk.parent_table)} parent ON ${conditions}
       JOIN cleanup_targets selected ON selected.table_name=$1 AND selected.row_tid=parent.ctid
       LIMIT 1`,
      [fk.parent_table],
    );
    if (result.rowCount) blockers.push(`${fk.child_table}.${fk.conname} -> ${fk.parent_table}`);
  }
  return [...new Set(blockers)];
}

function getDeleteOrder(schema, targetCounts) {
  const tables = [...targetCounts].filter(([, count]) => count > 0).map(([table]) => table);
  const tableSet = new Set(tables);
  const outgoing = new Map(tables.map((table) => [table, new Set()]));
  const indegree = new Map(tables.map((table) => [table, 0]));
  for (const fk of schema.fks) {
    // CASCADE is safe to delegate to PostgreSQL. Other actions are ordered
    // child-first so targeted rows are deleted before a parent can null or
    // otherwise rewrite their foreign-key columns.
    if (!['a', 'r', 'n', 'd'].includes(fk.delete_action)) continue;
    if (!tableSet.has(fk.child_table) || !tableSet.has(fk.parent_table) || fk.child_table === fk.parent_table) continue;
    const parents = outgoing.get(fk.child_table);
    if (!parents.has(fk.parent_table)) {
      parents.add(fk.parent_table);
      indegree.set(fk.parent_table, indegree.get(fk.parent_table) + 1);
    }
  }
  const ready = tables.filter((table) => indegree.get(table) === 0);
  const order = [];
  while (ready.length) {
    const table = ready.shift();
    order.push(table);
    for (const parent of outgoing.get(table)) {
      indegree.set(parent, indegree.get(parent) - 1);
      if (indegree.get(parent) === 0) ready.push(parent);
    }
  }
  if (order.length !== tables.length) {
    const cycle = tables.filter((table) => !order.includes(table));
    throw new Error(`Foreign-key dependency cycle among ${cycle.join(", ")}; refusing to delete.`);
  }
  return order;
}

async function run() {
  const options = getOptions();
  const { Client } = pg;
  const client = new Client(buildConnectionOptions(options.database));
  await client.connect();
  try {
    await client.query("BEGIN");
    if (options.apply) {
      const existingTables = await client.query(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])",
        [TRANSACTION_TABLES],
      );
      if (existingTables.rowCount) {
        const names = existingTables.rows.map((row) => tableRef(row.relname)).join(", ");
        await client.query(`LOCK TABLE ${names} IN SHARE ROW EXCLUSIVE MODE`);
      }
    }
    await client.query("CREATE TEMP TABLE cleanup_targets(table_name text NOT NULL,row_tid tid NOT NULL,PRIMARY KEY(table_name,row_tid)) ON COMMIT DROP");
    const schema = await getSchema(client);
    const partyTables = await client.query(
      "SELECT to_regclass('public.buyers') IS NOT NULL AS buyers_exist,to_regclass('public.suppliers') IS NOT NULL AS suppliers_exist",
    );
    if ((options.buyerIds.length && !partyTables.rows[0].buyers_exist) || (options.supplierIds.length && !partyTables.rows[0].suppliers_exist)) {
      throw new Error("Selected buyer/supplier master table is missing; refusing to continue.");
    }
    for (const [table, ids] of [["buyers", options.buyerIds], ["suppliers", options.supplierIds]]) {
      if (!ids.length) continue;
      const result = await client.query(`SELECT id FROM ${tableRef(table)} WHERE id=ANY($1::bigint[])`, [ids]);
      const found = new Set(result.rows.map((row) => String(row.id)));
      const missing = ids.filter((id) => !found.has(id));
      if (missing.length) throw new Error(`Unknown ${table} IDs: ${missing.join(", ")}`);
    }
    await seedDirectRecords(client, schema, options.buyerIds, options.supplierIds);
    await expandRelatedRecords(client, schema);

    const blockers = await getOutOfScopeReferences(client, schema);
    if (blockers.length) {
      throw new Error(`Linked rows exist outside the cleanup allowlist; nothing was deleted. Review: ${blockers.join("; ")}`);
    }

    const countResult = await client.query(
      "SELECT table_name,count(*)::int AS row_count FROM cleanup_targets GROUP BY table_name ORDER BY table_name",
    );
    const counts = new Map(countResult.rows.map((row) => [row.table_name, row.row_count]));
    const order = getDeleteOrder(schema, counts);
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);

    console.log(`Database: ${options.database}`);
    console.log(`Selected buyer IDs: ${options.buyerIds.join(", ") || "none"}`);
    console.log(`Selected supplier IDs: ${options.supplierIds.join(", ") || "none"}`);
    console.log("Buyer/supplier profiles, master data, configuration, settings and users are excluded.");
    console.log(`Linked transactional rows found: ${total}`);
    for (const [table, count] of counts) console.log(`  ${table}: ${count}`);

    if (!options.apply) {
      await client.query("ROLLBACK");
      console.log("Dry run only; no rows were deleted. Add --apply and the exact database confirmation to delete.");
      return;
    }

    let deleted = 0;
    for (const table of order) {
      const result = await client.query(
        `DELETE FROM ${tableRef(table)} target USING cleanup_targets selected WHERE selected.table_name=$1 AND selected.row_tid=target.ctid`,
        [table],
      );
      deleted += result.rowCount;
    }
    await client.query("COMMIT");
    console.log(`Deleted ${deleted} linked transactional rows. Buyer/supplier master records were preserved.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(`Data cleanup aborted: ${error.message}`);
  process.exitCode = 1;
});
