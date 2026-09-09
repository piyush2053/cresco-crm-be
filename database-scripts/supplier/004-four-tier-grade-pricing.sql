BEGIN;
ALTER TABLE supplier_grades ADD COLUMN IF NOT EXISTS master_grade_id BIGINT REFERENCES settings_master_records(id) ON DELETE RESTRICT;
ALTER TABLE supplier_grade_prices ADD COLUMN IF NOT EXISTS pure_price NUMERIC(14,4) CHECK(pure_price>=0);
ALTER TABLE supplier_grade_prices ADD COLUMN IF NOT EXISTS prime_price NUMERIC(14,4) CHECK(prime_price>=0);
ALTER TABLE supplier_grade_prices ADD COLUMN IF NOT EXISTS standard_price NUMERIC(14,4) CHECK(standard_price>=0);
ALTER TABLE supplier_grade_prices ADD COLUMN IF NOT EXISTS market_price NUMERIC(14,4) CHECK(market_price>=0);
ALTER TABLE supplier_grade_prices ADD COLUMN IF NOT EXISTS active_rate_type TEXT;
UPDATE supplier_grade_prices SET market_price=COALESCE(market_price,purchase_price),active_rate_type=COALESCE(active_rate_type,'market') WHERE market_price IS NULL OR active_rate_type IS NULL;
ALTER TABLE supplier_grade_prices DROP CONSTRAINT IF EXISTS supplier_grade_prices_active_rate_type_check;
ALTER TABLE supplier_grade_prices ADD CONSTRAINT supplier_grade_prices_active_rate_type_check CHECK(active_rate_type IN('pure','prime','standard','market'));
ALTER TABLE supplier_price_cell_history DROP CONSTRAINT IF EXISTS supplier_price_cell_history_field_name_check;
ALTER TABLE supplier_price_cell_history ADD CONSTRAINT supplier_price_cell_history_field_name_check CHECK(field_name IN('purchase_price','pure_price','prime_price','standard_price','market_price','active_rate_type','remarks'));
WITH grade_type AS(SELECT id FROM settings_master_types WHERE code='grades')
INSERT INTO settings_master_records(master_type_id,code,name,data,sort_order,is_active)
SELECT grade_type.id,'GRADE-'||substr(md5(lower(trim(w.grade))),1,12),trim(w.grade),jsonb_build_object('source','website_products'),row_number()OVER(ORDER BY lower(trim(w.grade))),true
FROM (SELECT DISTINCT grade FROM website_products WHERE NULLIF(trim(grade),'') IS NOT NULL)w CROSS JOIN grade_type
ON CONFLICT(master_type_id,code)DO UPDATE SET name=EXCLUDED.name,is_active=true,updated_at=now();
UPDATE supplier_grades g SET master_grade_id=r.id FROM settings_master_records r JOIN settings_master_types t ON t.id=r.master_type_id AND t.code='grades' WHERE lower(r.name)=lower(g.name) AND g.master_grade_id IS NULL;
COMMIT;
