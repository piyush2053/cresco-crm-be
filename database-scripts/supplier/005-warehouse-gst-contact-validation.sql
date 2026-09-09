BEGIN;
ALTER TABLE supplier_warehouses ADD COLUMN IF NOT EXISTS gst_number VARCHAR(15);
ALTER TABLE supplier_warehouses DROP CONSTRAINT IF EXISTS supplier_warehouses_gst_format;
ALTER TABLE supplier_warehouses ADD CONSTRAINT supplier_warehouses_gst_format
  CHECK(gst_number IS NULL OR gst_number~'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$') NOT VALID;
ALTER TABLE supplier_warehouses DROP CONSTRAINT IF EXISTS supplier_warehouses_contact_mobile_format;
ALTER TABLE supplier_warehouses ADD CONSTRAINT supplier_warehouses_contact_mobile_format
  CHECK(contact_details IS NULL OR contact_details~'^[0-9]{10}$') NOT VALID;
COMMIT;
