-- Integrated supplier procurement, bank accounts and working-capital migration.
-- Apply after supplier/001 and finance/001. Safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS procurement_banks (
 id BIGSERIAL PRIMARY KEY, bank_name TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN('Active','Inactive')),
 remarks TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS procurement_bank_accounts (
 id BIGSERIAL PRIMARY KEY, bank_id BIGINT NOT NULL REFERENCES procurement_banks(id) ON DELETE RESTRICT,
 account_number TEXT NOT NULL, account_type TEXT NOT NULL DEFAULT 'Current', has_cc_facility BOOLEAN NOT NULL DEFAULT FALSE,
 sanctioned_cc_limit NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK(sanctioned_cc_limit>=0), current_utilization NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK(current_utilization>=0),
 current_cc_rate NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK(current_cc_rate>=0 AND current_cc_rate<=100), rate_effective_from DATE,
 status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN('Active','Inactive')), remarks TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(bank_id,account_number),
 CHECK(NOT has_cc_facility OR sanctioned_cc_limit>0), CHECK(current_utilization<=sanctioned_cc_limit)
);
CREATE TABLE IF NOT EXISTS procurement_cc_rate_history (
 id BIGSERIAL PRIMARY KEY, account_id BIGINT NOT NULL REFERENCES procurement_bank_accounts(id) ON DELETE RESTRICT,
 annual_rate NUMERIC(7,4) NOT NULL CHECK(annual_rate>=0 AND annual_rate<=100), effective_from DATE NOT NULL,
 effective_to DATE, remarks TEXT, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(account_id,effective_from), CHECK(effective_to IS NULL OR effective_to>=effective_from)
);
CREATE TABLE IF NOT EXISTS supplier_procurement_transactions (
 id BIGSERIAL PRIMARY KEY, procurement_reference TEXT NOT NULL UNIQUE DEFAULT('PROC-'||to_char(CURRENT_DATE,'YYYY')||'-'||lpad(nextval('supplier_procurement_transactions_id_seq')::text,7,'0')),
 supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT, warehouse_id BIGINT NOT NULL REFERENCES supplier_warehouses(id) ON DELETE RESTRICT,
 order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL, transaction_id BIGINT REFERENCES sales_transactions(id) ON DELETE SET NULL,
 product_category TEXT NOT NULL, grade TEXT NOT NULL, quantity_kg NUMERIC(16,3) NOT NULL CHECK(quantity_kg>0), supplier_price NUMERIC(14,4) NOT NULL CHECK(supplier_price>=0),
 supplier_invoice_number TEXT, supplier_invoice_date DATE, purchase_order_reference TEXT, payment_amount NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK(payment_amount>=0), payment_date DATE,
 payment_status TEXT NOT NULL DEFAULT 'Pending' CHECK(payment_status IN('Pending','Part Paid','Paid','Cancelled')),
 bank_id BIGINT REFERENCES procurement_banks(id) ON DELETE RESTRICT, account_id BIGINT REFERENCES procurement_bank_accounts(id) ON DELETE RESTRICT,
 funding_type TEXT NOT NULL DEFAULT 'Own Funds' CHECK(funding_type IN('Own Funds','CC Funds')), cc_amount NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK(cc_amount>=0),
 cc_rate NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK(cc_rate>=0 AND cc_rate<=100), cc_utilization_date DATE, cc_settlement_date DATE,
 estimated_cc_interest NUMERIC(16,2) NOT NULL DEFAULT 0, actual_cc_interest NUMERIC(16,2), accrued_cc_interest NUMERIC(16,2) NOT NULL DEFAULT 0,
 logistics_reference TEXT, logistics_cost NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK(logistics_cost>=0), other_costs NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK(other_costs>=0),
 buyer_revenue NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK(buyer_revenue>=0), remarks TEXT, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(cc_settlement_date IS NULL OR cc_utilization_date IS NULL OR cc_settlement_date>=cc_utilization_date),
 CHECK((funding_type='Own Funds' AND cc_amount=0 AND cc_rate=0) OR (funding_type='CC Funds' AND account_id IS NOT NULL AND cc_amount>0 AND cc_utilization_date IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS supplier_procurement_audit (
 id BIGSERIAL PRIMARY KEY, transaction_id BIGINT NOT NULL REFERENCES supplier_procurement_transactions(id) ON DELETE CASCADE,
 action TEXT NOT NULL, previous_values JSONB, updated_values JSONB, changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL, changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_procurement_supplier_date ON supplier_procurement_transactions(supplier_id,supplier_invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_procurement_order ON supplier_procurement_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_procurement_account_open_cc ON supplier_procurement_transactions(account_id,cc_settlement_date) WHERE funding_type='CC Funds';
CREATE INDEX IF NOT EXISTS idx_cc_rate_account_effective ON procurement_cc_rate_history(account_id,effective_from DESC);

CREATE OR REPLACE VIEW supplier_procurement_economics_view AS
SELECT p.*,s.group_name supplier_name,w.warehouse_name,b.bank_name,a.account_number,a.account_type,
 CASE WHEN p.cc_utilization_date IS NULL THEN 0 ELSE GREATEST(COALESCE(p.cc_settlement_date,CURRENT_DATE)-p.cc_utilization_date,0) END cc_days,
 (p.quantity_kg*p.supplier_price) supplier_cost,
 COALESCE(p.actual_cc_interest,p.accrued_cc_interest,p.estimated_cc_interest,0) financing_cost,
 (p.quantity_kg*p.supplier_price+p.logistics_cost+COALESCE(p.actual_cc_interest,p.accrued_cc_interest,p.estimated_cc_interest,0)+p.other_costs) true_procurement_cost,
 (p.buyer_revenue-(p.quantity_kg*p.supplier_price+p.logistics_cost+COALESCE(p.actual_cc_interest,p.accrued_cc_interest,p.estimated_cc_interest,0)+p.other_costs)) netback,
 round(((p.buyer_revenue-(p.quantity_kg*p.supplier_price+p.logistics_cost+COALESCE(p.actual_cc_interest,p.accrued_cc_interest,p.estimated_cc_interest,0)+p.other_costs))/NULLIF(p.quantity_kg,0))::numeric,4) netback_per_kg
FROM supplier_procurement_transactions p JOIN suppliers s ON s.id=p.supplier_id JOIN supplier_warehouses w ON w.id=p.warehouse_id
LEFT JOIN procurement_banks b ON b.id=p.bank_id LEFT JOIN procurement_bank_accounts a ON a.id=p.account_id;

-- Supplier pricing expires automatically and is excluded from selection immediately.
UPDATE supplier_grade_prices SET is_active=FALSE WHERE is_active AND expires_at<=now();
COMMIT;
