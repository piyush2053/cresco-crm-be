ALTER TABLE logistics_transporters
  ADD COLUMN IF NOT EXISTS district_id BIGINT REFERENCES logistics_districts(id) ON DELETE SET NULL;

ALTER TABLE logistics_transporters
  ADD COLUMN IF NOT EXISTS location TEXT;

CREATE INDEX IF NOT EXISTS idx_logistics_transporters_district
  ON logistics_transporters(district_id);
