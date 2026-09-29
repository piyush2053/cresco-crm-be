BEGIN;
INSERT INTO logic_variables(variable_key,scope_type,scope_key,module_key,value,data_type,precedence,is_active)
VALUES
 ('Buyer_Credit_Interest_Rate','Global','*','orders','36'::jsonb,'Number',100,true),
 ('Existing_Buyer_Price_Adjustment','Global','*','orders','3'::jsonb,'Currency',100,true),
 ('Quotation_Additional_Per_Kg','Global','*','orders','0'::jsonb,'Currency',100,true)
ON CONFLICT(variable_key,scope_type,scope_key,effective_from) DO NOTHING;
COMMIT;
