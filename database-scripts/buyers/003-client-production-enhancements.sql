BEGIN;

-- Client-defined buyer turnover slabs (the legacy field name remains gst_slab).
UPDATE buyer_master_values
SET is_active = FALSE
WHERE master_type = 'gst_slab'
  AND label NOT IN ('0-40 Lakh','40 Lakh-1.5 Cr','1.5-5 Cr','5-25 Cr','25-100 Cr','100-500 Cr','500 Cr and above');

INSERT INTO buyer_master_values(master_type,label,code,is_active)
VALUES
  ('gst_slab','0-40 Lakh','TURNOVER_0_40_L',TRUE),
  ('gst_slab','40 Lakh-1.5 Cr','TURNOVER_40_L_1_5_CR',TRUE),
  ('gst_slab','1.5-5 Cr','TURNOVER_1_5_5_CR',TRUE),
  ('gst_slab','5-25 Cr','TURNOVER_5_25_CR',TRUE),
  ('gst_slab','25-100 Cr','TURNOVER_25_100_CR',TRUE),
  ('gst_slab','100-500 Cr','TURNOVER_100_500_CR',TRUE),
  ('gst_slab','500 Cr and above','TURNOVER_500_CR_PLUS',TRUE)
ON CONFLICT(master_type,label) DO UPDATE SET is_active=TRUE,code=EXCLUDED.code;

-- Configurable Buyer Group priority/category tags.
INSERT INTO buyer_master_values(master_type,label,code,is_active)
VALUES
  ('group_tag','Important Buyer','IMPORTANT_BUYER',TRUE),
  ('group_tag','Medium Priority','MEDIUM_PRIORITY',TRUE),
  ('group_tag','Standard Buyer','STANDARD_BUYER',TRUE),
  ('group_tag','Low Priority','LOW_PRIORITY',TRUE),
  ('group_tag','Strategic Account','STRATEGIC_ACCOUNT',TRUE),
  ('group_tag','Key Account','KEY_ACCOUNT',TRUE)
ON CONFLICT(master_type,label) DO UPDATE SET is_active=TRUE,code=EXCLUDED.code;

-- Reject invalid new/updated PAN and GSTIN values at the database boundary.
ALTER TABLE buyers DROP CONSTRAINT IF EXISTS buyers_pan_format_check;
ALTER TABLE buyers ADD CONSTRAINT buyers_pan_format_check
  CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$') NOT VALID;
ALTER TABLE buyer_locations DROP CONSTRAINT IF EXISTS buyer_locations_gstin_format_check;
ALTER TABLE buyer_locations ADD CONSTRAINT buyer_locations_gstin_format_check
  CHECK (gst_number IS NULL OR gst_number ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$') NOT VALID;

COMMIT;
