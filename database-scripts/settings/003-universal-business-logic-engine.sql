-- Universal Business Logic, Formula, Field and Configuration Engine.
BEGIN;
CREATE TABLE IF NOT EXISTS logic_objects(
 id BIGSERIAL PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,object_type TEXT NOT NULL CHECK(object_type IN('Formula','Business Rule','Validation','Workflow','Approval','Alert','Scoring','Automation','KPI','Dashboard Widget','Report')),
 module_key TEXT NOT NULL,table_key TEXT,output_field TEXT,description TEXT,purpose TEXT,owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 status TEXT NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Test','Pending Approval','Live','Retired','Error')),current_version_id BIGINT,
 effective_from TIMESTAMPTZ,effective_until TIMESTAMPTZ,configuration JSONB NOT NULL DEFAULT '{}',created_by INTEGER REFERENCES users(id),updated_by INTEGER REFERENCES users(id),created_at TIMESTAMPTZ DEFAULT now(),updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS logic_versions(
 id BIGSERIAL PRIMARY KEY,object_id BIGINT NOT NULL REFERENCES logic_objects(id) ON DELETE CASCADE,version_number INTEGER NOT NULL,expression TEXT,
 visual_definition JSONB NOT NULL DEFAULT '{}',dependencies JSONB NOT NULL DEFAULT '[]',change_reason TEXT NOT NULL,test_status TEXT NOT NULL DEFAULT 'Not Tested' CHECK(test_status IN('Not Tested','Passed','Failed')),
 test_summary JSONB NOT NULL DEFAULT '{}',effective_from TIMESTAMPTZ,effective_until TIMESTAMPTZ,created_by INTEGER REFERENCES users(id),approved_by INTEGER REFERENCES users(id),created_at TIMESTAMPTZ DEFAULT now(),approved_at TIMESTAMPTZ,UNIQUE(object_id,version_number)
);
ALTER TABLE logic_objects DROP CONSTRAINT IF EXISTS logic_objects_current_version_id_fkey;
ALTER TABLE logic_objects ADD CONSTRAINT logic_objects_current_version_id_fkey FOREIGN KEY(current_version_id) REFERENCES logic_versions(id) ON DELETE SET NULL;
ALTER TABLE logic_objects ADD COLUMN IF NOT EXISTS live_version_id BIGINT REFERENCES logic_versions(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS logic_fields(
 id BIGSERIAL PRIMARY KEY,module_key TEXT NOT NULL,table_key TEXT NOT NULL,field_key TEXT NOT NULL,label TEXT NOT NULL,
 field_type TEXT NOT NULL CHECK(field_type IN('Text','Long Text','Number','Currency','Percentage','Date','Date Time','Checkbox','Email','Phone','Dropdown','Multi-select','User','Buyer','Supplier','Product','Grade','Location','Formula','Calculated','Lookup','Aggregated','Relation','Auto-number','System')),
 position INTEGER DEFAULT 0,width INTEGER DEFAULT 160,is_frozen BOOLEAN DEFAULT FALSE,is_hidden BOOLEAN DEFAULT FALSE,is_required BOOLEAN DEFAULT FALSE,
 required_condition JSONB DEFAULT '{}',default_value JSONB,options_key TEXT,formula_object_id BIGINT REFERENCES logic_objects(id) ON DELETE SET NULL,validation JSONB DEFAULT '{}',is_active BOOLEAN DEFAULT TRUE,created_by INTEGER REFERENCES users(id),updated_by INTEGER REFERENCES users(id),created_at TIMESTAMPTZ DEFAULT now(),updated_at TIMESTAMPTZ DEFAULT now(),UNIQUE(module_key,table_key,field_key)
);
CREATE TABLE IF NOT EXISTS logic_variables(
 id BIGSERIAL PRIMARY KEY,variable_key TEXT NOT NULL,scope_type TEXT NOT NULL CHECK(scope_type IN('Global','Module','Group','Record')),scope_key TEXT NOT NULL DEFAULT '*',module_key TEXT,
 value JSONB NOT NULL,data_type TEXT NOT NULL DEFAULT 'Number',precedence INTEGER NOT NULL DEFAULT 0,effective_from TIMESTAMPTZ DEFAULT now(),effective_until TIMESTAMPTZ,is_active BOOLEAN DEFAULT TRUE,created_by INTEGER REFERENCES users(id),updated_by INTEGER REFERENCES users(id),created_at TIMESTAMPTZ DEFAULT now(),updated_at TIMESTAMPTZ DEFAULT now(),UNIQUE(variable_key,scope_type,scope_key,effective_from)
);
CREATE TABLE IF NOT EXISTS logic_option_sets(id BIGSERIAL PRIMARY KEY,option_key TEXT NOT NULL UNIQUE,name TEXT NOT NULL,module_key TEXT,description TEXT,is_active BOOLEAN DEFAULT TRUE,created_by INTEGER REFERENCES users(id),updated_by INTEGER REFERENCES users(id),created_at TIMESTAMPTZ DEFAULT now(),updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS logic_options(id BIGSERIAL PRIMARY KEY,option_set_id BIGINT NOT NULL REFERENCES logic_option_sets(id) ON DELETE CASCADE,value TEXT NOT NULL,label TEXT NOT NULL,parent_option_id BIGINT REFERENCES logic_options(id) ON DELETE RESTRICT,sort_order INTEGER DEFAULT 0,is_default BOOLEAN DEFAULT FALSE,is_active BOOLEAN DEFAULT TRUE,metadata JSONB DEFAULT '{}',UNIQUE(option_set_id,value));
CREATE TABLE IF NOT EXISTS logic_relationships(id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,source_module TEXT NOT NULL,source_table TEXT NOT NULL,source_field TEXT NOT NULL,target_module TEXT NOT NULL,target_table TEXT NOT NULL,target_field TEXT NOT NULL,relationship_type TEXT NOT NULL CHECK(relationship_type IN('One-to-one','One-to-many','Many-to-one','Many-to-many')),is_active BOOLEAN DEFAULT TRUE,created_by INTEGER REFERENCES users(id),created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS logic_calculation_snapshots(id BIGSERIAL PRIMARY KEY,object_id BIGINT NOT NULL REFERENCES logic_objects(id) ON DELETE RESTRICT,version_id BIGINT NOT NULL REFERENCES logic_versions(id) ON DELETE RESTRICT,module_key TEXT NOT NULL,record_id TEXT NOT NULL,input_values JSONB NOT NULL,calculated_values JSONB NOT NULL,is_final BOOLEAN DEFAULT FALSE,recalculated_from_id BIGINT REFERENCES logic_calculation_snapshots(id),created_by INTEGER REFERENCES users(id),created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS logic_evaluation_log(id BIGSERIAL PRIMARY KEY,object_id BIGINT REFERENCES logic_objects(id) ON DELETE SET NULL,version_id BIGINT REFERENCES logic_versions(id) ON DELETE SET NULL,module_key TEXT,record_id TEXT,status TEXT NOT NULL,error_code TEXT,error_message TEXT,input_values JSONB,result JSONB,duration_ms INTEGER,evaluated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS logic_saved_views(id BIGSERIAL PRIMARY KEY,module_key TEXT NOT NULL,table_key TEXT NOT NULL,name TEXT NOT NULL,configuration JSONB NOT NULL DEFAULT '{}',is_shared BOOLEAN DEFAULT FALSE,owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,created_at TIMESTAMPTZ DEFAULT now(),updated_at TIMESTAMPTZ DEFAULT now(),UNIQUE(owner_id,module_key,table_key,name));
CREATE TABLE IF NOT EXISTS logic_configuration_backups(id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,configuration JSONB NOT NULL,created_by INTEGER REFERENCES users(id),created_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_logic_objects_search ON logic_objects(module_key,object_type,status);
CREATE INDEX IF NOT EXISTS idx_logic_versions_object ON logic_versions(object_id,version_number DESC);
CREATE INDEX IF NOT EXISTS idx_logic_fields_table ON logic_fields(module_key,table_key,position);
CREATE INDEX IF NOT EXISTS idx_logic_variables_resolution ON logic_variables(variable_key,scope_type,scope_key,precedence DESC) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_logic_eval_errors ON logic_evaluation_log(status,evaluated_at DESC);
CREATE OR REPLACE FUNCTION logic_preserve_live_during_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.live_version_id IS NOT NULL AND NEW.live_version_id=OLD.live_version_id AND NEW.status IN('Draft','Test') THEN NEW.status='Live'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_logic_preserve_live ON logic_objects;
CREATE TRIGGER trg_logic_preserve_live BEFORE UPDATE ON logic_objects FOR EACH ROW EXECUTE FUNCTION logic_preserve_live_during_draft();
UPDATE roles SET permissions=jsonb_set(COALESCE(permissions,'{}'::jsonb),'{modules,business_logic}','true'::jsonb,true);
COMMIT;
