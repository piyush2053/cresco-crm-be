BEGIN;

-- Repair the legacy spelling that prevented exact master-data rate resolution.
UPDATE ex_cresco_prices
SET product_category = 'Titanium Dioxide (TiO2)'
WHERE regexp_replace(lower(product_category), '[^a-z0-9]', '', 'g')
      IN ('titaniumdiosxide', 'titaniumdiosxidetio2');

UPDATE ex_cresco_price_history
SET product_category = 'Titanium Dioxide (TiO2)'
WHERE regexp_replace(lower(product_category), '[^a-z0-9]', '', 'g')
      IN ('titaniumdiosxide', 'titaniumdiosxidetio2');

-- Backfill only unpriced standard quotations. Existing-buyer re-quotes have a
-- separate historical-price rule and are intentionally not guessed here.
WITH settings AS (
  SELECT
    COALESCE(max(numeric_value) FILTER (WHERE setting_key = 'buyer_credit_interest_rate'), 36) AS credit_rate,
    COALESCE(max(numeric_value) FILTER (WHERE setting_key = 'quotation_additional_per_kg'), 0) AS configured_additional
  FROM quotation_settings
), resolved AS (
  SELECT p.id, t.inquiry_date, xr.rate_per_kg AS base_rate,
         fr.base_freight_per_kg AS freight_rate,
         s.credit_rate, s.configured_additional,
         xr.rate_per_kg + fr.base_freight_per_kg
           + ((xr.rate_per_kg + fr.base_freight_per_kg) * s.credit_rate / 100 * COALESCE(p.credit_days, 0) / 365)
           + COALESCE(p.additional_charges, 0) + s.configured_additional AS total_rate
  FROM sales_transaction_products p
  JOIN sales_transactions t ON t.id = p.transaction_id AND t.deleted_at IS NULL
  CROSS JOIN settings s
  JOIN LATERAL (
    SELECT x.rate_per_kg
    FROM ex_cresco_prices x
    WHERE x.is_active
      AND lower(trim(x.product_category)) = lower(trim(p.product_category))
      AND lower(trim(x.grade)) = lower(trim(p.grade))
      AND x.valid_from <= t.inquiry_date
      AND (x.valid_to IS NULL OR x.valid_to >= t.inquiry_date)
    ORDER BY x.valid_from DESC, x.created_at DESC
    LIMIT 1
  ) xr ON true
  JOIN LATERAL (
    SELECT f.base_freight_per_kg
    FROM logistics_base_freight f
    WHERE f.is_active
      AND f.from_district_id = p.from_district_id
      AND f.to_district_id = p.to_district_id
      AND f.quantity_kg = p.quantity_kg
      AND f.effective_from <= t.inquiry_date
      AND (f.effective_to IS NULL OR f.effective_to >= t.inquiry_date)
    ORDER BY f.version DESC, f.created_at DESC
    LIMIT 1
  ) fr ON true
  WHERE p.quote_rate_snapshot IS NULL
    AND p.ex_cresco_rate IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM orders o
      WHERE o.buyer_id = t.buyer_id
        AND lower(trim(o.product_category)) = lower(trim(p.product_category))
        AND lower(trim(o.grade)) = lower(trim(p.grade))
        AND lower(o.status) IN ('completed', 'delivered', 'fulfilled')
        AND o.deleted_at IS NULL
    )
)
UPDATE sales_transaction_products p
SET ex_cresco_rate = r.base_rate,
    quote_freight_per_kg = r.freight_rate,
    logistics_cost = r.freight_rate,
    credit_interest_rate = r.credit_rate,
    credit_cost_snapshot = (r.base_rate + r.freight_rate) * r.credit_rate / 100 * COALESCE(p.credit_days, 0) / 365,
    credit_cost = (r.base_rate + r.freight_rate) * r.credit_rate / 100 * COALESCE(p.credit_days, 0) / 365,
    configured_components_snapshot = r.configured_additional,
    suggested_quote_price = r.total_rate,
    quote_rate_snapshot = r.total_rate,
    quoted_price = COALESCE(p.quoted_price, r.total_rate),
    final_quote_price = COALESCE(p.final_quote_price, r.total_rate),
    quote_date = COALESCE(p.quote_date, r.inquiry_date::timestamp),
    updated_at = now()
FROM resolved r
WHERE p.id = r.id;

COMMIT;
