BEGIN;
ALTER TABLE logistics_transporters ALTER COLUMN transporter_code TYPE VARCHAR(15);
ALTER TABLE logistics_transporters DROP CONSTRAINT IF EXISTS logistics_transporters_transporter_code_format;
ALTER TABLE logistics_transporters ADD CONSTRAINT logistics_transporters_transporter_code_format CHECK(transporter_code ~ '^[A-Z0-9]{15}$') NOT VALID;
COMMIT;
