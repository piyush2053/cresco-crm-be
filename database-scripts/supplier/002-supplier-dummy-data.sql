BEGIN;
WITH s AS (INSERT INTO suppliers(group_name,pan,gst_number,primary_contact_name,primary_contact_number,email,supplier_tag) VALUES('Dummy Lomon Group','AAAAA3333A','24AAAAA3333A1Z5','Demo Supplier Contact','9000000010','supplier@example.com','Preferred') RETURNING id),
w AS (INSERT INTO supplier_warehouses(supplier_id,warehouse_name,address,dispatch_location,payment_terms,credit_days) SELECT id,'Ahmedabad Warehouse','Dummy Industrial Area','Ahmedabad','Advance',15 FROM s RETURNING id),
c AS (INSERT INTO supplier_product_categories(warehouse_id,name) SELECT id,'Titanium Dioxide' FROM w RETURNING id),
g AS (INSERT INTO supplier_grades(category_id,name) SELECT id,'R6618' FROM c RETURNING id)
INSERT INTO supplier_grade_prices(grade_id,purchase_price,remarks,expires_at) SELECT g.id,215.50,'Dummy current price',now()+interval '48 hours' FROM g;
COMMIT;
