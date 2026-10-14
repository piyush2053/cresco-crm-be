-- Company bank account master used by Settings, working capital and sales documents.
BEGIN;

ALTER TABLE procurement_bank_accounts ADD COLUMN IF NOT EXISTS account_name TEXT;
ALTER TABLE procurement_bank_accounts ADD COLUMN IF NOT EXISTS branch_name TEXT;
ALTER TABLE procurement_bank_accounts ADD COLUMN IF NOT EXISTS ifsc_code TEXT;
ALTER TABLE procurement_bank_accounts ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_procurement_primary_bank_account
 ON procurement_bank_accounts(is_primary) WHERE is_primary;

WITH chosen AS (
 SELECT id FROM procurement_bank_accounts
 WHERE status='Active' ORDER BY is_primary DESC,created_at,id LIMIT 1
)
UPDATE procurement_bank_accounts a SET is_primary=(a.id=(SELECT id FROM chosen))
WHERE EXISTS(SELECT 1 FROM chosen);

CREATE OR REPLACE FUNCTION procurement_bank_primary_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.is_primary AND NEW.status<>'Active' THEN RAISE EXCEPTION 'The primary bank account must be active.'; END IF;
 IF NEW.is_primary THEN UPDATE procurement_bank_accounts SET is_primary=FALSE WHERE id<>NEW.id AND is_primary; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_procurement_bank_primary_guard ON procurement_bank_accounts;
CREATE TRIGGER trg_procurement_bank_primary_guard BEFORE INSERT OR UPDATE OF is_primary,status ON procurement_bank_accounts FOR EACH ROW EXECUTE FUNCTION procurement_bank_primary_guard();

CREATE OR REPLACE FUNCTION procurement_bank_require_primary() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM procurement_bank_accounts) AND NOT EXISTS(SELECT 1 FROM procurement_bank_accounts WHERE is_primary AND status='Active') THEN
  RAISE EXCEPTION 'One active bank account must remain primary.';
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_procurement_bank_require_primary ON procurement_bank_accounts;
CREATE CONSTRAINT TRIGGER trg_procurement_bank_require_primary AFTER INSERT OR UPDATE OR DELETE ON procurement_bank_accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION procurement_bank_require_primary();

COMMIT;
