BEGIN;

ALTER TABLE sales_transaction_products
  ADD COLUMN IF NOT EXISTS from_district_id BIGINT REFERENCES logistics_districts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS to_district_id BIGINT REFERENCES logistics_districts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_transaction_products_district_freight
  ON sales_transaction_products(from_district_id,to_district_id,quantity_kg);

-- Preserve old inquiries as-is while linking district names where an
-- unambiguous active master record already exists.
UPDATE sales_transaction_products product
SET to_district_id=district.id
FROM logistics_districts district
WHERE product.to_district_id IS NULL
  AND upper(trim(product.delivery_to))=upper(trim(district.name))
  AND district.is_active
  AND (SELECT count(*) FROM logistics_districts candidate
       WHERE candidate.is_active
         AND upper(trim(candidate.name))=upper(trim(product.delivery_to)))=1;

COMMIT;
