-- Roll back only after exporting flow records and reverting the application release.
BEGIN;
DROP TRIGGER IF EXISTS order_flow_transaction_guard ON sales_transactions;
DROP TRIGGER IF EXISTS order_flow_product_guard ON sales_transaction_products;
DROP FUNCTION IF EXISTS enforce_order_flow_owner();
UPDATE sales_transactions t SET current_stage=f.legacy_stage,status=f.legacy_status,updated_at=now()
 FROM order_flows f WHERE f.transaction_id=t.id AND f.legacy_stage IS NOT NULL;
DROP TABLE IF EXISTS order_flow_requests,order_flow_drafts,order_flow_logs,
 order_flow_credit_checks,order_flow_price_overrides,order_flow_suppliers,
 order_flow_vehicles,order_flow_invoices,order_flow_settings,order_flow_tasks,order_flows;
COMMIT;
