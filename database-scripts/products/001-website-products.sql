BEGIN;

CREATE TABLE IF NOT EXISTS website_products (
  id BIGSERIAL PRIMARY KEY,
  legacy_id BIGINT UNIQUE,
  company TEXT NOT NULL,
  country TEXT NOT NULL,
  method TEXT NOT NULL,
  grade TEXT NOT NULL,
  application TEXT NOT NULL,
  description TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'Titanium Dioxide (TiO2)',
  datasheet_path TEXT,
  sample_path TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT website_products_business_key UNIQUE (company, country, method, grade, application)
);

CREATE INDEX IF NOT EXISTS idx_website_products_active_sort ON website_products(is_active, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_website_products_grade_lower ON website_products(lower(grade));
CREATE INDEX IF NOT EXISTS idx_website_products_filters ON website_products(company, country, method, application);

CREATE OR REPLACE FUNCTION set_website_products_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_website_products_updated_at ON website_products;
CREATE TRIGGER trg_website_products_updated_at
BEFORE UPDATE ON website_products
FOR EACH ROW EXECUTE FUNCTION set_website_products_updated_at();

UPDATE roles
SET permissions = jsonb_set(COALESCE(permissions, '{}'::jsonb), '{modules,website_products}', 'true'::jsonb, true)
WHERE name = 'Admin';

COMMIT;
