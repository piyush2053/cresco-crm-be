import { query } from "../src/db.js";

const checks = {
  counts: `SELECT count(*)::int total,
    count(*) FILTER (WHERE is_active)::int active,
    count(*) FILTER (WHERE data->>'source'='DISTIRCTS.xlsx')::int official,
    count(*) FILTER (WHERE data->>'created_from'='freight_import')::int import_created
    FROM logistics_districts`,
  duplicate_names: `SELECT upper(trim(name)) normalized, count(*)::int copies,
    json_agg(json_build_object('id',id,'name',name,'state',state,'active',is_active,
      'source',data->>'source','created_from',data->>'created_from') ORDER BY id) rows
    FROM logistics_districts GROUP BY upper(trim(name)) HAVING count(*)>1
    ORDER BY copies DESC,normalized LIMIT 50`,
  non_master_rates: `SELECT count(*)::int rates,
    count(*) FILTER (WHERE b.is_active)::int active_rates
    FROM logistics_base_freight b
    JOIN logistics_districts f ON f.id=b.from_district_id
    JOIN logistics_districts t ON t.id=b.to_district_id
    WHERE f.data->>'source' IS DISTINCT FROM 'DISTIRCTS.xlsx'
       OR t.data->>'source' IS DISTINCT FROM 'DISTIRCTS.xlsx'`,
};

for (const [name, sql] of Object.entries(checks)) {
  const result = await query(sql);
  console.log(name, JSON.stringify(result.rows));
}
process.exit(0);
