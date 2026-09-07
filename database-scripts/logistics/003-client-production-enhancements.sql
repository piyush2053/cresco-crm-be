BEGIN;
ALTER TABLE supplier_warehouses ADD COLUMN IF NOT EXISTS warehouse_code TEXT;
ALTER TABLE supplier_warehouses ADD COLUMN IF NOT EXISTS district TEXT;
ALTER TABLE supplier_warehouses ADD COLUMN IF NOT EXISTS pincode VARCHAR(6);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_warehouse_code ON supplier_warehouses(warehouse_code) WHERE warehouse_code IS NOT NULL;
ALTER TABLE logistics_transporters ADD COLUMN IF NOT EXISTS pincode VARCHAR(6);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS pincode VARCHAR(6);
ALTER TABLE buyer_locations ADD COLUMN IF NOT EXISTS pincode VARCHAR(6);
ALTER TABLE logistics_shipments ADD COLUMN IF NOT EXISTS shipment_code TEXT;
UPDATE logistics_shipments SET shipment_code='SHP-'||lpad(id::text,7,'0') WHERE shipment_code IS NULL;
ALTER TABLE logistics_shipments ALTER COLUMN shipment_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_logistics_shipment_code ON logistics_shipments(shipment_code);
CREATE SEQUENCE IF NOT EXISTS logistics_shipment_code_seq;
SELECT setval('logistics_shipment_code_seq',GREATEST((SELECT COALESCE(max(id),0) FROM logistics_shipments),1));
ALTER TABLE logistics_shipments ALTER COLUMN shipment_code SET DEFAULT ('SHP-'||lpad(nextval('logistics_shipment_code_seq')::text,7,'0'));
CREATE TABLE IF NOT EXISTS logistics_lane_note_options(id BIGSERIAL PRIMARY KEY,label TEXT NOT NULL UNIQUE,is_active BOOLEAN NOT NULL DEFAULT TRUE,sort_order INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS supplier_grade_price_factors(id BIGSERIAL PRIMARY KEY,grade_id BIGINT NOT NULL REFERENCES supplier_grades(id) ON DELETE CASCADE,factor_name TEXT NOT NULL,adjustment_type TEXT NOT NULL CHECK(adjustment_type IN('Flat','Percentage')),adjustment_value NUMERIC(14,4) NOT NULL,remarks TEXT,is_active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ DEFAULT now(),updated_at TIMESTAMPTZ DEFAULT now(),UNIQUE(grade_id,factor_name));
-- Legacy payment_terms/credit_days columns are retained to preserve existing data,
-- but new UI/API flows do not write them. Commercial terms belong to each deal.
COMMIT;
