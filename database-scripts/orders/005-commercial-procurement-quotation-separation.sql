BEGIN;

-- Commercial quote prices are maintained independently of supplier prices.
CREATE TABLE IF NOT EXISTS ex_cresco_prices (
  id BIGSERIAL PRIMARY KEY,
  product_category TEXT NOT NULL,
  grade TEXT NOT NULL,
  rate_per_kg NUMERIC(14,4) NOT NULL CHECK (rate_per_kg >= 0),
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  remarks TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS idx_ex_cresco_prices_lookup ON ex_cresco_prices(product_category, grade, is_active, valid_from, valid_to);

CREATE TABLE IF NOT EXISTS quotation_settings (
  setting_key TEXT PRIMARY KEY,
  numeric_value NUMERIC(14,6) NOT NULL,
  unit TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO quotation_settings(setting_key,numeric_value,unit) VALUES
  ('buyer_credit_interest_rate',36,'percent_per_annum'),
  ('existing_buyer_price_adjustment',3,'INR_per_kg'),
  ('quotation_additional_per_kg',0,'INR_per_kg')
ON CONFLICT(setting_key) DO NOTHING;

ALTER TABLE sales_transaction_products
  ADD COLUMN IF NOT EXISTS buyer_location_id BIGINT REFERENCES buyer_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS procurement_quality TEXT CHECK (procurement_quality IN ('New','Standard','Prime','Market')),
  ADD COLUMN IF NOT EXISTS ex_cresco_rate NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS quote_freight_per_kg NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS credit_days INTEGER NOT NULL DEFAULT 0 CHECK (credit_days BETWEEN 0 AND 366),
  ADD COLUMN IF NOT EXISTS credit_interest_rate NUMERIC(9,4),
  ADD COLUMN IF NOT EXISTS credit_cost_snapshot NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS configured_components_snapshot NUMERIC(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quote_rate_snapshot NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS quote_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS historical_order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS historical_snapshot JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS suggested_quote_price NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS final_quote_price NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS override_difference NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS override_reason TEXT,
  ADD COLUMN IF NOT EXISTS override_user INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS override_at TIMESTAMPTZ;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS quality TEXT,
  ADD COLUMN IF NOT EXISTS supplier_warehouse_id BIGINT REFERENCES supplier_warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ex_cresco_rate_per_kg NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS quoted_freight_per_kg NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS quote_credit_days INTEGER,
  ADD COLUMN IF NOT EXISTS quote_credit_rate NUMERIC(9,4),
  ADD COLUMN IF NOT EXISTS quote_credit_cost_per_kg NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS configured_components_per_kg NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS quote_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quoted_buyer_price_per_kg NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS actual_freight_per_kg NUMERIC(14,4);

ALTER TABLE sales_quote_revision_lines
  ADD COLUMN IF NOT EXISTS ex_cresco_rate NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS quote_freight_per_kg NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS credit_days INTEGER,
  ADD COLUMN IF NOT EXISTS credit_interest_rate NUMERIC(9,4),
  ADD COLUMN IF NOT EXISTS credit_cost_snapshot NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS configured_components_snapshot NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS quote_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS historical_snapshot JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS suggested_quote_price NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS final_quote_price NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS override_reason TEXT,
  ADD COLUMN IF NOT EXISTS override_user INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS override_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS ex_cresco_price_history (
  id BIGSERIAL PRIMARY KEY,
  price_id BIGINT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created','deactivated')),
  product_category TEXT NOT NULL,
  grade TEXT NOT NULL,
  rate_per_kg NUMERIC(14,4) NOT NULL,
  valid_from DATE NOT NULL,
  valid_to DATE,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotation_settings_history (
  id BIGSERIAL PRIMARY KEY,
  setting_key TEXT NOT NULL,
  previous_value NUMERIC(14,6),
  new_value NUMERIC(14,6) NOT NULL,
  change_reason TEXT NOT NULL,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_quote_overrides (
  id BIGSERIAL PRIMARY KEY,
  transaction_id BIGINT NOT NULL REFERENCES sales_transactions(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES sales_transaction_products(id) ON DELETE CASCADE,
  suggested_price NUMERIC(14,4) NOT NULL,
  final_price NUMERIC(14,4) NOT NULL,
  difference NUMERIC(14,4) NOT NULL,
  reason TEXT NOT NULL,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
