BEGIN;
ALTER TABLE buyers ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(16,2) NOT NULL DEFAULT 0;
ALTER TABLE buyer_custom_field_definitions ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE buyer_custom_field_definitions ADD COLUMN IF NOT EXISTS validation JSONB NOT NULL DEFAULT '{}';
ALTER TABLE buyers DROP CONSTRAINT IF EXISTS buyers_credit_limit_non_negative;
ALTER TABLE buyers ADD CONSTRAINT buyers_credit_limit_non_negative CHECK (credit_limit >= 0) NOT VALID;
CREATE OR REPLACE FUNCTION sync_buyer_logic_field() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.module_key='buyers' AND NEW.table_key='buyers' THEN
    INSERT INTO buyer_custom_field_definitions(field_key,label,field_type,is_required,is_active,sort_order,is_hidden,validation)
    VALUES(NEW.field_key,NEW.label,NEW.field_type,NEW.is_required,NEW.is_active,NEW.position,NEW.is_hidden,NEW.validation)
    ON CONFLICT(field_key) DO UPDATE SET label=EXCLUDED.label,field_type=EXCLUDED.field_type,is_required=EXCLUDED.is_required,
      is_active=EXCLUDED.is_active,sort_order=EXCLUDED.sort_order,is_hidden=EXCLUDED.is_hidden,validation=EXCLUDED.validation;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sync_buyer_logic_field ON logic_fields;
CREATE TRIGGER trg_sync_buyer_logic_field AFTER INSERT OR UPDATE ON logic_fields FOR EACH ROW EXECUTE FUNCTION sync_buyer_logic_field();
COMMIT;
