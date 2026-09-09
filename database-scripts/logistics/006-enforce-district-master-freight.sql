BEGIN;

-- Freight imports used to create "Unmapped" districts. Build only safe,
-- one-to-one mappings to the imported 788-row District Master.
CREATE TEMP TABLE district_master_map ON COMMIT DROP AS
SELECT legacy.id legacy_id, min(master.id) master_id
FROM logistics_districts legacy
JOIN logistics_districts master
  ON upper(trim(master.name))=upper(trim(legacy.name))
 AND master.data->>'source'='DISTIRCTS.xlsx'
 AND master.is_active
WHERE legacy.data->>'created_from'='freight_import'
GROUP BY legacy.id
HAVING count(master.id)=1;

-- Preserve inquiry and logistics references where the mapping is unambiguous.
UPDATE sales_transaction_products p SET from_district_id=m.master_id
FROM district_master_map m WHERE p.from_district_id=m.legacy_id;
UPDATE sales_transaction_products p SET to_district_id=m.master_id
FROM district_master_map m WHERE p.to_district_id=m.legacy_id;
UPDATE logistics_transactions t SET from_district_id=m.master_id
FROM district_master_map m WHERE t.from_district_id=m.legacy_id;
UPDATE logistics_transactions t SET to_district_id=m.master_id
FROM district_master_map m WHERE t.to_district_id=m.legacy_id;

-- Copy the latest active legacy rate onto the canonical District Master IDs.
-- A fresh version avoids collisions with existing canonical rate history.
DO $$
DECLARE r record; next_version integer;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (fm.master_id,tm.master_id,b.quantity_kg)
      b.*,fm.master_id canonical_from,tm.master_id canonical_to
    FROM logistics_base_freight b
    JOIN district_master_map fm ON fm.legacy_id=b.from_district_id
    JOIN district_master_map tm ON tm.legacy_id=b.to_district_id
    WHERE b.is_active
    ORDER BY fm.master_id,tm.master_id,b.quantity_kg,b.version DESC,b.created_at DESC,b.id DESC
  LOOP
    UPDATE logistics_base_freight SET is_active=false,effective_to=CURRENT_DATE
    WHERE from_district_id=r.canonical_from AND to_district_id=r.canonical_to
      AND quantity_kg=r.quantity_kg AND is_active;
    SELECT COALESCE(max(version),0)+1 INTO next_version
    FROM logistics_base_freight WHERE from_district_id=r.canonical_from
      AND to_district_id=r.canonical_to AND quantity_kg=r.quantity_kg;
    INSERT INTO logistics_base_freight(
      from_district_id,to_district_id,quantity_kg,base_freight_per_kg,
      effective_from,effective_to,source,source_reference,version,is_active,
      created_by,created_at,import_id)
    VALUES(r.canonical_from,r.canonical_to,r.quantity_kg,r.base_freight_per_kg,
      CURRENT_DATE,NULL,r.source,concat_ws(' | ',r.source_reference,'District Master reconciliation'),
      next_version,true,r.created_by,now(),r.import_id);
  END LOOP;
END $$;

-- No active freight rate or dropdown option may remain on legacy districts.
UPDATE logistics_base_freight b SET is_active=false,effective_to=COALESCE(effective_to,CURRENT_DATE)
WHERE EXISTS (SELECT 1 FROM logistics_districts d
              WHERE d.id IN (b.from_district_id,b.to_district_id)
                AND d.data->>'created_from'='freight_import');
UPDATE logistics_districts SET is_active=false,updated_at=now()
WHERE data->>'created_from'='freight_import';

CREATE OR REPLACE FUNCTION enforce_active_freight_district_master()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM logistics_districts WHERE id=NEW.from_district_id AND is_active)
     OR NOT EXISTS(SELECT 1 FROM logistics_districts WHERE id=NEW.to_district_id AND is_active) THEN
    RAISE EXCEPTION 'Freight districts must be active District Master records';
  END IF;
  IF NEW.from_district_id=NEW.to_district_id THEN
    RAISE EXCEPTION 'From and To districts must be different';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_active_freight_district_master ON logistics_base_freight;
CREATE TRIGGER trg_enforce_active_freight_district_master
BEFORE INSERT OR UPDATE OF from_district_id,to_district_id,is_active
ON logistics_base_freight FOR EACH ROW
WHEN (NEW.is_active)
EXECUTE FUNCTION enforce_active_freight_district_master();

COMMIT;
