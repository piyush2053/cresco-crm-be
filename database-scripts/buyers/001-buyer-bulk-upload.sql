-- Buyer GST hierarchy and source-specific contact details.
ALTER TABLE buyer_locations ADD COLUMN IF NOT EXISTS business_type TEXT;
ALTER TABLE buyer_locations ADD COLUMN IF NOT EXISTS turnover TEXT;
ALTER TABLE buyer_locations ADD COLUMN IF NOT EXISTS turnover_heading TEXT;
ALTER TABLE buyer_locations ADD COLUMN IF NOT EXISTS registration_status TEXT;
ALTER TABLE buyer_locations ADD COLUMN IF NOT EXISTS business_constitution TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_buyer_locations_gstin
  ON buyer_locations (upper(gst_number)) WHERE gst_number IS NOT NULL AND btrim(gst_number) <> '';

CREATE TABLE IF NOT EXISTS buyer_contact_locations (
  contact_id BIGINT NOT NULL REFERENCES buyer_contacts(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES buyer_locations(id) ON DELETE CASCADE,
  phone_number TEXT,
  email_address TEXT,
  source_row INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, location_id)
);
CREATE INDEX IF NOT EXISTS idx_buyer_contact_locations_location ON buyer_contact_locations(location_id);
CREATE INDEX IF NOT EXISTS idx_buyer_contacts_normalized_phone
  ON buyer_contacts (regexp_replace(mobile_number, '[^0-9]', '', 'g'))
  WHERE mobile_number IS NOT NULL AND btrim(mobile_number) <> '';

