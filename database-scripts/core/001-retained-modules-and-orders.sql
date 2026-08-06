BEGIN;
CREATE SEQUENCE IF NOT EXISTS crm_order_seq START 1;
CREATE TABLE IF NOT EXISTS orders(
 id BIGSERIAL PRIMARY KEY,
 order_number TEXT NOT NULL UNIQUE DEFAULT('ORD-'||to_char(CURRENT_DATE,'YY')||'-'||lpad(nextval('crm_order_seq')::text,6,'0')),
 buyer_id BIGINT NOT NULL REFERENCES buyers(id) ON DELETE RESTRICT,
 supplier_id BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
 logistics_lane_id BIGINT REFERENCES logistics_lanes(id) ON DELETE SET NULL,
 product_category TEXT NOT NULL, grade TEXT NOT NULL, quantity_kg NUMERIC(14,3) NOT NULL CHECK(quantity_kg>0),
 sale_price_per_kg NUMERIC(14,4),purchase_price_per_kg NUMERIC(14,4),freight_per_kg NUMERIC(14,4),
 total_order_value NUMERIC(16,2) GENERATED ALWAYS AS(quantity_kg*COALESCE(sale_price_per_kg,0)) STORED,
 gross_margin NUMERIC(16,2) GENERATED ALWAYS AS(quantity_kg*(COALESCE(sale_price_per_kg,0)-COALESCE(purchase_price_per_kg,0)-COALESCE(freight_per_kg,0))) STORED,
 status TEXT NOT NULL DEFAULT 'Draft',order_date DATE NOT NULL DEFAULT CURRENT_DATE,expected_delivery_date DATE,remarks TEXT,
 created_at TIMESTAMPTZ DEFAULT now(),updated_at TIMESTAMPTZ DEFAULT now(),deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status,expected_delivery_date);
UPDATE roles SET permissions=(jsonb_set(jsonb_set(COALESCE(permissions,'{}'::jsonb),'{modules}',COALESCE(permissions->'modules','{}'::jsonb),true),'{modules,orders}','true',true)
 #- '{modules,leads}' #- '{modules,enquiries}' #- '{modules,deals}' #- '{modules,quotations}' #- '{modules,followups}' #- '{modules,chemicals}');
COMMIT;
