-- Preserve the GST/warehouse identities used for each historical and future order.
-- Safe to re-run after buyers/001, supplier/001 and orders/001.
BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS buyer_location_id BIGINT REFERENCES buyer_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_warehouse_id BIGINT REFERENCES supplier_warehouses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_buyer_location ON orders(buyer_location_id);
CREATE INDEX IF NOT EXISTS idx_orders_supplier_warehouse ON orders(supplier_warehouse_id);

COMMIT;
