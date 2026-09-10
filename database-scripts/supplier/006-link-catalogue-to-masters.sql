BEGIN;

ALTER TABLE supplier_product_categories
  ADD COLUMN IF NOT EXISTS master_category_id BIGINT REFERENCES settings_master_records(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_supplier_categories_master
  ON supplier_product_categories(master_category_id);

-- Exact normalized match first.
UPDATE supplier_product_categories category
SET master_category_id=master.id
FROM settings_master_records master
JOIN settings_master_types type ON type.id=master.master_type_id AND type.code='product_categories'
WHERE category.master_category_id IS NULL AND master.is_active
  AND regexp_replace(lower(category.name),'[^a-z0-9]','','g')=regexp_replace(lower(master.name),'[^a-z0-9]','','g');

-- Legacy short labels such as TIO2 may be contained in one and only one master label.
WITH candidates AS (
  SELECT category.id category_id,master.id master_id
  FROM supplier_product_categories category
  JOIN settings_master_records master ON master.is_active
  JOIN settings_master_types type ON type.id=master.master_type_id AND type.code='product_categories'
  WHERE category.master_category_id IS NULL
    AND length(regexp_replace(lower(category.name),'[^a-z0-9]','','g'))>=4
    AND strpos(regexp_replace(lower(master.name),'[^a-z0-9]','','g'),regexp_replace(lower(category.name),'[^a-z0-9]','','g'))>0
), unique_candidates AS (
  SELECT category_id,min(master_id) master_id FROM candidates GROUP BY category_id HAVING count(*)=1
)
UPDATE supplier_product_categories category SET master_category_id=candidate.master_id
FROM unique_candidates candidate WHERE category.id=candidate.category_id;

UPDATE supplier_grades grade
SET master_grade_id=master.id
FROM settings_master_records master
JOIN settings_master_types type ON type.id=master.master_type_id AND type.code='grades'
WHERE grade.master_grade_id IS NULL AND master.is_active
  AND regexp_replace(lower(grade.name),'[^a-z0-9]','','g')=regexp_replace(lower(master.name),'[^a-z0-9]','','g');

COMMIT;
