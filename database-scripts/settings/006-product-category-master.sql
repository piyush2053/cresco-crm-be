BEGIN;

INSERT INTO settings_master_records
  (master_type_id,code,name,data,sort_order,is_active)
SELECT type.id,seed.code,seed.name,'{"source":"website_catalogue"}'::jsonb,seed.sort_order,true
FROM settings_master_types type
CROSS JOIN (VALUES
  ('TITANIUM-DIOXIDE','Titanium Dioxide (TiO2)',1),
  ('OPTICAL-BRIGHTENER','Optical Brightener',2),
  ('WAX','Wax',3),
  ('STEARATES','Stearates',4),
  ('STEARIC-ACIDS','Stearic Acids',5),
  ('LITHOPONE','Lithopone',6),
  ('CARBON','Carbon',7),
  ('PROCESSING-AIDS','Processing Aids',8)
) AS seed(code,name,sort_order)
WHERE type.code='product_categories'
ON CONFLICT(master_type_id,code) DO UPDATE SET
  name=EXCLUDED.name,
  sort_order=EXCLUDED.sort_order,
  is_active=true,
  updated_at=now();

COMMIT;
