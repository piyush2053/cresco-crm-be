BEGIN;
WITH ranked AS (
 SELECT id,widget_type,row_number() OVER(PARTITION BY dashboard_id,widget_type ORDER BY position,id) occurrence
 FROM bi_dashboard_widgets
 WHERE NOT(configuration ? 'aggregations')
)
UPDATE bi_dashboard_widgets w SET
 title=CASE
  WHEN r.widget_type='KPI Card' THEN 'Total Revenue'
  WHEN r.widget_type='Pie Chart' THEN 'Outstanding by State'
  WHEN r.widget_type='Line Chart' AND r.occurrence=1 THEN 'Revenue by Order Date'
  WHEN r.widget_type='Line Chart' THEN 'Gross Profit by Order Date'
  ELSE w.title END,
 configuration=CASE
  WHEN r.widget_type='KPI Card' THEN '{"data_source":"finance","grouping":[],"aggregations":[{"field":"gross_revenue","function":"sum","alias":"value"}],"limit":1}'::jsonb
  WHEN r.widget_type='Pie Chart' THEN '{"data_source":"finance","grouping":["state"],"aggregations":[{"field":"outstanding_amount","function":"sum","alias":"value"}],"limit":12}'::jsonb
  WHEN r.widget_type='Line Chart' AND r.occurrence=1 THEN '{"data_source":"finance","grouping":["order_date"],"aggregations":[{"field":"gross_revenue","function":"sum","alias":"value"}],"limit":12}'::jsonb
  WHEN r.widget_type='Line Chart' THEN '{"data_source":"finance","grouping":["order_date"],"aggregations":[{"field":"gross_profit","function":"sum","alias":"value"}],"limit":12}'::jsonb
  ELSE jsonb_build_object('data_source','finance','grouping','[]'::jsonb,'aggregations','[{"field":"gross_revenue","function":"sum","alias":"value"}]'::jsonb,'limit',12) END,
 updated_at=now()
FROM ranked r WHERE w.id=r.id;
COMMIT;
