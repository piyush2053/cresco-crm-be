-- Additive production foundation for the client Logistics SRS. Existing records are preserved.
BEGIN;
CREATE TABLE IF NOT EXISTS logistics_districts(id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,state TEXT NOT NULL,state_code TEXT,code TEXT UNIQUE,is_active BOOLEAN NOT NULL DEFAULT TRUE,data JSONB NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ DEFAULT now(),updated_at TIMESTAMPTZ DEFAULT now(),UNIQUE(name,state));
CREATE TABLE IF NOT EXISTS logistics_district_pincodes(id BIGSERIAL PRIMARY KEY,district_id BIGINT NOT NULL REFERENCES logistics_districts(id) ON DELETE CASCADE,pincode VARCHAR(6) NOT NULL CHECK(pincode~'^[0-9]{6}$'),is_active BOOLEAN NOT NULL DEFAULT TRUE,UNIQUE(district_id,pincode));
CREATE INDEX IF NOT EXISTS idx_logistics_district_search ON logistics_districts(name,state,state_code);
CREATE INDEX IF NOT EXISTS idx_logistics_pincode_search ON logistics_district_pincodes(pincode);

CREATE TABLE IF NOT EXISTS logistics_base_freight(id BIGSERIAL PRIMARY KEY,from_district_id BIGINT NOT NULL REFERENCES logistics_districts(id),to_district_id BIGINT NOT NULL REFERENCES logistics_districts(id),quantity_kg NUMERIC(14,3) NOT NULL CHECK(quantity_kg>0),base_freight_per_kg NUMERIC(14,4) NOT NULL CHECK(base_freight_per_kg>=0),effective_from DATE NOT NULL DEFAULT CURRENT_DATE,effective_to DATE,source TEXT NOT NULL DEFAULT 'Manual',source_reference TEXT,version INTEGER NOT NULL DEFAULT 1,is_active BOOLEAN NOT NULL DEFAULT TRUE,created_by INTEGER REFERENCES users(id),created_at TIMESTAMPTZ DEFAULT now(),UNIQUE(from_district_id,to_district_id,quantity_kg,version));
CREATE INDEX IF NOT EXISTS idx_base_freight_lookup ON logistics_base_freight(from_district_id,to_district_id,quantity_kg,is_active,effective_from DESC);

CREATE TABLE IF NOT EXISTS logistics_cost_heads(id BIGSERIAL PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,is_required BOOLEAN NOT NULL DEFAULT FALSE,is_active BOOLEAN NOT NULL DEFAULT TRUE,allow_negative BOOLEAN NOT NULL DEFAULT FALSE,data JSONB NOT NULL DEFAULT '{}');
INSERT INTO logistics_cost_heads(code,name,sort_order) VALUES ('main_transport','Main Transport',10),('local_transport','Local Transport',20),('warehouse_delivery','Warehouse Delivery',30),('door_delivery','Door Delivery',40),('porter','Porter',50),('pallet','Pallet',60),('open_pallet','Open Pallet',70),('other','Other',80) ON CONFLICT(code) DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS logistics_transaction_seq;
CREATE TABLE IF NOT EXISTS logistics_transactions(id BIGSERIAL PRIMARY KEY,transaction_code TEXT NOT NULL UNIQUE DEFAULT('LOG-'||lpad(nextval('logistics_transaction_seq')::text,6,'0')),order_id BIGINT REFERENCES orders(id) ON DELETE RESTRICT,shipment_id BIGINT REFERENCES logistics_shipments(id) ON DELETE RESTRICT,buyer_id BIGINT REFERENCES buyers(id) ON DELETE RESTRICT,supplier_id BIGINT REFERENCES suppliers(id) ON DELETE RESTRICT,from_district_id BIGINT REFERENCES logistics_districts(id),to_district_id BIGINT REFERENCES logistics_districts(id),quantity_kg NUMERIC(14,3) NOT NULL CHECK(quantity_kg>0),transporter_id BIGINT REFERENCES logistics_transporters(id) ON DELETE RESTRICT,quote_id BIGINT REFERENCES logistics_quotes(id) ON DELETE SET NULL,transporter_invoice TEXT,estimated_cost NUMERIC(16,2),estimated_freight_per_kg NUMERIC(14,4),prediction_source TEXT,prediction_date TIMESTAMPTZ,actual_cost NUMERIC(16,2),actual_freight_per_kg NUMERIC(14,4),variance NUMERIC(16,2),variance_percent NUMERIC(10,4),cost_status TEXT NOT NULL DEFAULT 'Estimated' CHECK(cost_status IN('Estimated','Pending Actual','Partially Updated','Finalized')),workflow_status TEXT NOT NULL DEFAULT 'Draft',calculation_snapshot JSONB NOT NULL DEFAULT '{}',remarks TEXT,created_by INTEGER REFERENCES users(id),updated_by INTEGER REFERENCES users(id),created_at TIMESTAMPTZ DEFAULT now(),updated_at TIMESTAMPTZ DEFAULT now(),finalized_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS idx_logistics_transaction_route ON logistics_transactions(from_district_id,to_district_id,quantity_kg,created_at DESC);

CREATE TABLE IF NOT EXISTS logistics_transaction_costs(id BIGSERIAL PRIMARY KEY,transaction_id BIGINT NOT NULL REFERENCES logistics_transactions(id) ON DELETE CASCADE,cost_head_id BIGINT NOT NULL REFERENCES logistics_cost_heads(id),cost_stage TEXT NOT NULL CHECK(cost_stage IN('Estimated','Actual')),amount NUMERIC(16,2),is_confirmed BOOLEAN NOT NULL DEFAULT FALSE,remarks TEXT,updated_by INTEGER REFERENCES users(id),updated_at TIMESTAMPTZ DEFAULT now(),UNIQUE(transaction_id,cost_head_id,cost_stage));
COMMENT ON COLUMN logistics_transaction_costs.amount IS 'NULL means not entered; zero means confirmed as not incurred.';

CREATE TABLE IF NOT EXISTS logistics_audit_history(id BIGSERIAL PRIMARY KEY,entity_type TEXT NOT NULL DEFAULT 'base_freight',entity_id BIGINT,record BIGINT,field_name TEXT,field TEXT,old_value JSONB,new_value JSONB,reason TEXT,source TEXT,rule_version TEXT,related_transaction_id BIGINT REFERENCES logistics_transactions(id),changed_by INTEGER REFERENCES users(id),user_id INTEGER REFERENCES users(id),changed_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_logistics_audit_entity ON logistics_audit_history(entity_type,entity_id,changed_at DESC);

ALTER TABLE logistics_quotes ADD COLUMN IF NOT EXISTS quote_code TEXT;
ALTER TABLE logistics_quotes ADD COLUMN IF NOT EXISTS valid_until DATE;
ALTER TABLE logistics_quotes ADD COLUMN IF NOT EXISTS related_order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE logistics_quotes ADD COLUMN IF NOT EXISTS cost_bifurcation JSONB NOT NULL DEFAULT '{}';
ALTER TABLE logistics_transporters ADD COLUMN IF NOT EXISTS operational_data JSONB NOT NULL DEFAULT '{}';
ALTER TABLE logistics_transporters ADD COLUMN IF NOT EXISTS issue_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE logistics_transporters ADD COLUMN IF NOT EXISTS complaint_count INTEGER NOT NULL DEFAULT 0;
COMMIT;
