BEGIN;

ALTER TABLE buyer_locations
  ADD COLUMN IF NOT EXISTS district_id BIGINT REFERENCES logistics_districts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_buyer_locations_district
  ON buyer_locations(buyer_id, district_id);

-- GST source locations carry the postal code inside the permanent address.
UPDATE buyer_locations
SET pincode=substring(address from '([1-9][0-9]{5})'), updated_at=now()
WHERE (pincode IS NULL OR pincode='')
  AND address~'[1-9][0-9]{5}';

-- Backfill only when one pincode maps to exactly one active canonical district.
WITH unique_pincodes AS (
  SELECT p.pincode, min(p.district_id) district_id
  FROM logistics_district_pincodes p
  JOIN logistics_districts d ON d.id=p.district_id AND d.is_active
  WHERE p.is_active
  GROUP BY p.pincode
  HAVING count(DISTINCT p.district_id)=1
)
UPDATE buyer_locations location
SET district_id=match.district_id, updated_at=now()
FROM unique_pincodes match
WHERE location.district_id IS NULL
  AND location.pincode=match.pincode;

-- Current GST source addresses include exact comma-separated district/state
-- segments. Use them only when they identify one canonical district.
WITH address_candidates AS (
  SELECT location.id location_id, district.id district_id
  FROM buyer_locations location
  JOIN logistics_districts district ON district.is_active
  WHERE location.district_id IS NULL
    AND EXISTS (SELECT 1 FROM unnest(string_to_array(location.address,',')) segment WHERE lower(trim(segment))=lower(trim(district.name)))
    AND EXISTS (SELECT 1 FROM unnest(string_to_array(location.address,',')) segment WHERE lower(trim(segment))=lower(trim(district.state)))
), unique_addresses AS (
  SELECT location_id,min(district_id) district_id
  FROM address_candidates
  GROUP BY location_id
  HAVING count(DISTINCT district_id)=1
)
UPDATE buyer_locations location
SET district_id=match.district_id, updated_at=now()
FROM unique_addresses match
WHERE location.id=match.location_id;

COMMIT;
