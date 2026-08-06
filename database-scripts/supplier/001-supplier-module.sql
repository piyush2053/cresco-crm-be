-- Supplier module migration. Run once on the existing Cresco PostgreSQL database.
BEGIN;
CREATE TABLE suppliers (
 id BIGSERIAL PRIMARY KEY, group_name TEXT NOT NULL, pan VARCHAR(10) UNIQUE, gst_number VARCHAR(15),
 primary_contact_name TEXT, primary_contact_number TEXT, email TEXT, country TEXT DEFAULT 'India',
 registered_address TEXT, supplier_tag TEXT, remarks TEXT, is_active BOOLEAN DEFAULT TRUE,
 created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE supplier_contacts (
 id BIGSERIAL PRIMARY KEY, supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
 name TEXT NOT NULL, department TEXT, designation TEXT, mobile_number TEXT, email_address TEXT,
 whatsapp_number TEXT, notes TEXT, is_primary BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX uq_supplier_primary_contact ON supplier_contacts(supplier_id) WHERE is_primary;
CREATE TABLE supplier_warehouses (
 id BIGSERIAL PRIMARY KEY, supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
 warehouse_name TEXT NOT NULL, address TEXT, primary_contact TEXT, contact_details TEXT,
 dispatch_location TEXT, payment_terms TEXT, credit_days INTEGER CHECK(credit_days>=0),
 created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE supplier_product_categories (
 id BIGSERIAL PRIMARY KEY, warehouse_id BIGINT NOT NULL REFERENCES supplier_warehouses(id) ON DELETE CASCADE,
 name TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), UNIQUE(warehouse_id,name)
);
CREATE TABLE supplier_grades (
 id BIGSERIAL PRIMARY KEY, category_id BIGINT NOT NULL REFERENCES supplier_product_categories(id) ON DELETE CASCADE,
 name TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), UNIQUE(category_id,name)
);
CREATE TABLE supplier_grade_prices (
 id BIGSERIAL PRIMARY KEY, grade_id BIGINT NOT NULL REFERENCES supplier_grades(id) ON DELETE CASCADE,
 purchase_price NUMERIC(14,4) NOT NULL CHECK(purchase_price>=0), remarks TEXT,
 effective_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL,
 is_active BOOLEAN NOT NULL DEFAULT TRUE, updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE supplier_price_cell_history (
 id BIGSERIAL PRIMARY KEY, price_id BIGINT NOT NULL REFERENCES supplier_grade_prices(id) ON DELETE CASCADE,
 field_name TEXT NOT NULL CHECK(field_name IN ('purchase_price','remarks')), previous_value TEXT,
 updated_value TEXT, change_remarks TEXT, updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 changed_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE supplier_documents (
 id BIGSERIAL PRIMARY KEY, supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
 file_name TEXT NOT NULL, file_url TEXT NOT NULL, document_type TEXT, uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE supplier_activities (
 id BIGSERIAL PRIMARY KEY, supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
 activity_type TEXT NOT NULL, description TEXT NOT NULL, metadata JSONB DEFAULT '{}',
 created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, occurred_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE procurement_preferences (
 id BIGSERIAL PRIMARY KEY, preference_level TEXT NOT NULL CHECK(preference_level IN ('customer_product_grade','product_grade','grade')),
 buyer_id BIGINT REFERENCES buyers(id) ON DELETE CASCADE, category_name TEXT, grade_name TEXT NOT NULL,
 supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
 warehouse_id BIGINT REFERENCES supplier_warehouses(id) ON DELETE CASCADE, priority INTEGER DEFAULT 1,
 is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE procurement_settings (
 id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(id=1), price_validity_hours INTEGER NOT NULL DEFAULT 48 CHECK(price_validity_hours>0),
 preference_hierarchy JSONB NOT NULL DEFAULT '["customer_product_grade","product_grade","grade","lowest_valid_price"]', updated_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO procurement_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE INDEX idx_suppliers_search ON suppliers(group_name,pan,gst_number);
CREATE INDEX idx_supplier_warehouse_supplier ON supplier_warehouses(supplier_id);
CREATE INDEX idx_supplier_category_warehouse ON supplier_product_categories(warehouse_id);
CREATE INDEX idx_supplier_grade_category ON supplier_grades(category_id);
CREATE INDEX idx_supplier_prices_grade_valid ON supplier_grade_prices(grade_id,is_active,expires_at,purchase_price);
CREATE INDEX idx_supplier_activity_timeline ON supplier_activities(supplier_id,occurred_at DESC);
CREATE INDEX idx_procurement_preferences_lookup ON procurement_preferences(buyer_id,category_name,grade_name,preference_level,is_active);
CREATE OR REPLACE FUNCTION supplier_one_primary_contact() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.is_primary THEN UPDATE supplier_contacts SET is_primary=FALSE WHERE supplier_id=NEW.supplier_id AND id<>COALESCE(NEW.id,0); END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_supplier_primary BEFORE INSERT OR UPDATE OF is_primary ON supplier_contacts FOR EACH ROW EXECUTE FUNCTION supplier_one_primary_contact();

-- Remove legacy vendor relations without deleting operational records.
DO $$ DECLARE r record; t text; BEGIN
 IF to_regclass('public.vendors') IS NOT NULL THEN
  FOR r IN SELECT conrelid::regclass table_name,conname FROM pg_constraint WHERE confrelid='public.vendors'::regclass LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',r.table_name,r.conname); END LOOP;
 END IF;
 FOREACH t IN ARRAY ARRAY['enquiries','deals','quotations','finance'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='vendor_id') THEN
   EXECUTE format('ALTER TABLE %I RENAME COLUMN vendor_id TO supplier_id',t); EXECUTE format('UPDATE %I SET supplier_id=NULL',t);
   EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL',t,t||'_supplier_id_fkey');
  END IF;
 END LOOP;
END $$;
DROP TABLE IF EXISTS vendor_uploads;
DROP TABLE IF EXISTS vendors;
UPDATE roles SET permissions=(jsonb_set(jsonb_set(COALESCE(permissions,'{}'::jsonb),'{modules}',COALESCE(permissions->'modules','{}'::jsonb),true),'{modules,suppliers}','true',true) #- '{modules,vendors}');
COMMIT;
