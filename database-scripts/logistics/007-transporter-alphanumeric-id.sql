BEGIN;
ALTER TABLE logistics_transporters ADD COLUMN IF NOT EXISTS transporter_code VARCHAR(30);
UPDATE logistics_transporters SET transporter_code=upper(regexp_replace(gst_number,'[^A-Za-z0-9]','','g')) WHERE transporter_code IS NULL AND NULLIF(btrim(gst_number),'') IS NOT NULL;
UPDATE logistics_transporters SET transporter_code='TRN'||lpad(id::text,6,'0') WHERE transporter_code IS NULL OR btrim(transporter_code)='';
ALTER TABLE logistics_transporters ALTER COLUMN transporter_code SET NOT NULL;
ALTER TABLE logistics_transporters DROP CONSTRAINT IF EXISTS logistics_transporters_transporter_code_format;
ALTER TABLE logistics_transporters ADD CONSTRAINT logistics_transporters_transporter_code_format CHECK(transporter_code~'^[A-Z0-9]+$');
CREATE UNIQUE INDEX IF NOT EXISTS uq_logistics_transporter_code_ci ON logistics_transporters(upper(transporter_code));
COMMIT;
