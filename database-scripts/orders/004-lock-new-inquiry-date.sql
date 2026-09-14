BEGIN;
CREATE OR REPLACE FUNCTION lock_new_inquiry_date_to_today() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.inquiry_date := CURRENT_DATE;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_lock_new_inquiry_date ON sales_transactions;
CREATE TRIGGER trg_lock_new_inquiry_date BEFORE INSERT ON sales_transactions FOR EACH ROW EXECUTE FUNCTION lock_new_inquiry_date_to_today();
COMMIT;
