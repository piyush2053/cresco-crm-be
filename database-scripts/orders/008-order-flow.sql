BEGIN;
CREATE TABLE IF NOT EXISTS order_flows (
 transaction_id BIGINT PRIMARY KEY REFERENCES sales_transactions(id),
 order_no TEXT NOT NULL UNIQUE,
 buyer_id BIGINT NOT NULL REFERENCES buyers(id),
 legacy_stage TEXT,
 legacy_status TEXT,
 current_stage TEXT NOT NULL DEFAULT '0',
 status TEXT NOT NULL DEFAULT 'Open',
 version INTEGER NOT NULL DEFAULT 0,
 stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 data JSONB NOT NULL DEFAULT '{}',
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_flow_stage ON order_flows(current_stage,updated_at);
CREATE INDEX IF NOT EXISTS idx_order_flow_buyer ON order_flows(buyer_id,status);
CREATE INDEX IF NOT EXISTS idx_order_flow_status ON order_flows(status);
CREATE TABLE IF NOT EXISTS order_flow_logs (
 id BIGSERIAL PRIMARY KEY, transaction_id BIGINT NOT NULL REFERENCES order_flows(transaction_id),
 stage TEXT NOT NULL, action TEXT NOT NULL, fields JSONB NOT NULL DEFAULT '{}',
 actor INTEGER REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_flow_logs ON order_flow_logs(transaction_id,created_at DESC);
CREATE TABLE IF NOT EXISTS order_flow_drafts (
 transaction_id BIGINT NOT NULL REFERENCES order_flows(transaction_id), stage TEXT NOT NULL,
 actor INTEGER NOT NULL REFERENCES users(id), fields JSONB NOT NULL DEFAULT '{}',
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(transaction_id,stage,actor)
);
CREATE TABLE IF NOT EXISTS order_flow_requests (
 transaction_id BIGINT NOT NULL REFERENCES order_flows(transaction_id), request_key TEXT NOT NULL,
 actor INTEGER NOT NULL REFERENCES users(id), fingerprint TEXT NOT NULL, response JSONB NOT NULL,
 PRIMARY KEY(transaction_id,request_key)
);
CREATE TABLE IF NOT EXISTS order_flow_credit_checks (
 id BIGSERIAL PRIMARY KEY, transaction_id BIGINT NOT NULL REFERENCES order_flows(transaction_id),
 result JSONB NOT NULL, actor INTEGER REFERENCES users(id), override_reason TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_flow_price_overrides (
 id BIGSERIAL PRIMARY KEY, transaction_id BIGINT NOT NULL REFERENCES order_flows(transaction_id),
 old_price NUMERIC(14,4), new_price NUMERIC(14,4) NOT NULL, reason TEXT NOT NULL,
 actor INTEGER REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_flow_suppliers (
 id BIGSERIAL PRIMARY KEY, transaction_id BIGINT NOT NULL REFERENCES order_flows(transaction_id),
 supplier_id BIGINT NOT NULL REFERENCES suppliers(id), data JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS order_flow_vehicles (
 id BIGSERIAL PRIMARY KEY, transaction_id BIGINT NOT NULL REFERENCES order_flows(transaction_id), data JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS order_flow_invoices (
 id BIGSERIAL PRIMARY KEY, transaction_id BIGINT NOT NULL REFERENCES order_flows(transaction_id),
 type TEXT NOT NULL CHECK(type IN ('supplier','buyer')), number TEXT NOT NULL,
 data JSONB NOT NULL, UNIQUE(transaction_id,type,number)
);
CREATE TABLE IF NOT EXISTS order_flow_settings (
 key TEXT PRIMARY KEY, value NUMERIC NOT NULL CHECK(value>=0)
);
CREATE TABLE IF NOT EXISTS order_flow_tasks (
 id BIGSERIAL PRIMARY KEY,transaction_id BIGINT NOT NULL REFERENCES order_flows(transaction_id),
 kind TEXT NOT NULL,assigned_role TEXT NOT NULL,due_date DATE NOT NULL DEFAULT CURRENT_DATE,
 status TEXT NOT NULL DEFAULT 'Pending',attempts INTEGER NOT NULL DEFAULT 0,last_error_code TEXT,
 details JSONB NOT NULL DEFAULT '{}',UNIQUE(transaction_id,kind)
);
-- Block old APIs from bypassing the flow once explicitly enrolled.
CREATE OR REPLACE FUNCTION enforce_order_flow_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tx BIGINT;
BEGIN
 IF TG_TABLE_NAME='sales_transactions' THEN
  tx:=OLD.id;
  IF current_setting('cresco.order_flow_write',true)='on' THEN RETURN NEW; END IF;
  IF NEW.current_stage IS NOT DISTINCT FROM OLD.current_stage THEN RETURN NEW; END IF;
 ELSE
  IF TG_OP='INSERT' THEN tx:=NEW.transaction_id; ELSE tx:=OLD.transaction_id; END IF;
 END IF;
 PERFORM id FROM sales_transactions WHERE id=tx FOR UPDATE;
 IF EXISTS(SELECT 1 FROM order_flows WHERE transaction_id=tx) THEN
  RAISE EXCEPTION 'Use the order flow API for enrolled transactions' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS order_flow_transaction_guard ON sales_transactions;
CREATE TRIGGER order_flow_transaction_guard BEFORE UPDATE ON sales_transactions FOR EACH ROW EXECUTE FUNCTION enforce_order_flow_owner();
DROP TRIGGER IF EXISTS order_flow_product_guard ON sales_transaction_products;
CREATE TRIGGER order_flow_product_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_transaction_products FOR EACH ROW EXECUTE FUNCTION enforce_order_flow_owner();
INSERT INTO order_flow_settings(key,value) VALUES ('quantity_tolerance_percent',2),('stuck_days',3),('packing_volume_m3_per_kg',0.002) ON CONFLICT DO NOTHING;
-- No automatic stage conversion: legacy stages do not establish completion of PRD fields.
-- Existing transactions remain operational. Explicit enrollment starts at stage 0.
COMMIT;
