BEGIN;
DO $$
DECLARE actor integer; example record; object_id bigint; version_id bigint;
BEGIN
 SELECT id INTO actor FROM users WHERE is_admin ORDER BY id LIMIT 1;
 IF actor IS NULL THEN SELECT id INTO actor FROM users ORDER BY id LIMIT 1; END IF;
 FOR example IN SELECT * FROM (VALUES
  ('EXAMPLE_LANDED_COST','Example: Order Landed Cost','Formula','orders','orders','landed_cost_per_kg','Supplier price plus freight and additional charges.','Supplier_Price+Freight+Additional_Charges'),
  ('EXAMPLE_MARGIN_PER_KG','Example: Margin Per Kg','KPI','orders','orders','margin_per_kg','Selling price remaining after supplier, freight and additional costs.','Buyer_Price-Supplier_Price-Freight-Additional_Charges'),
  ('EXAMPLE_MINIMUM_MARGIN_CHECK','Example: Minimum Margin Check','Validation','orders','orders','margin_is_valid','Returns true when calculated margin meets the configured minimum margin.','Buyer_Price-Supplier_Price-Freight>=VAR("Minimum_Margin_Per_Kg")'),
  ('EXAMPLE_CREDIT_COST','Example: Credit Cost Per Kg','Formula','finance','finance_commercial_records','credit_cost_per_kg','Illustrates percentage-based credit cost calculation.','ROUND(Purchase_Price*Credit_Rate_Percent/100,4)')
 ) AS x(code,name,object_type,module_key,table_key,output_field,description,expression)
 LOOP
  INSERT INTO logic_objects(code,name,object_type,module_key,table_key,output_field,description,purpose,status,configuration,owner_id,created_by,updated_by)
  VALUES(example.code,example.name,example.object_type,example.module_key,example.table_key,example.output_field,example.description,'Learning example - copy or edit, sandbox test, then approve before operational use.','Draft','{"is_example":true}'::jsonb,actor,actor,actor)
  ON CONFLICT(code) DO NOTHING RETURNING id INTO object_id;
  IF object_id IS NOT NULL THEN
   INSERT INTO logic_versions(object_id,version_number,expression,dependencies,change_reason,created_by)
   VALUES(object_id,1,example.expression,'[]'::jsonb,'Seeded learning example',actor) RETURNING id INTO version_id;
   UPDATE logic_objects SET current_version_id=version_id WHERE id=object_id;
  END IF;
  object_id:=NULL; version_id:=NULL;
 END LOOP;
 INSERT INTO logic_variables(variable_key,scope_type,scope_key,module_key,value,data_type,precedence,is_active,created_by,updated_by)
 VALUES('Minimum_Margin_Per_Kg','Global','*','orders','5'::jsonb,'Number',0,true,actor,actor)
 ON CONFLICT DO NOTHING;
END $$;
COMMIT;
