-- PostgreSQL initialization for Cresco CRM
-- Run: psql -h localhost -U postgres -f db-init.sql

DROP DATABASE IF EXISTS cresco_local;
CREATE DATABASE cresco_local;
\c cresco_local;

-- users table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role_id INTEGER,
  is_admin BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  email_verified BOOLEAN DEFAULT FALSE,
  otp_code VARCHAR(10),
  otp_expires_at TIMESTAMP,
  refresh_token TEXT,
  reset_token TEXT,
  reset_expires_at TIMESTAMP,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);

-- roles table
CREATE TABLE roles (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  permissions JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT now()
);

-- Buyer is the only customer/client entity.
CREATE TABLE buyers (
  id BIGSERIAL PRIMARY KEY, group_name TEXT NOT NULL,
  pan VARCHAR(10) NOT NULL UNIQUE CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  gst_slab TEXT, state TEXT, group_tag TEXT, reference TEXT, parent_location TEXT,
  remark TEXT, lead_manager TEXT, lead_type TEXT, monthly_consumption NUMERIC(14,3),
  call_date DATE, next_call_date DATE, call_remark TEXT,
  profile_shared BOOLEAN NOT NULL DEFAULT FALSE, quote_shared BOOLEAN NOT NULL DEFAULT FALSE,
  order_status TEXT NOT NULL DEFAULT 'Prospect', credit_interest TEXT,
  order_count INTEGER NOT NULL DEFAULT 0, first_order_date DATE, last_order_date DATE,
  total_revenue NUMERIC(16,2) NOT NULL DEFAULT 0, lifecycle_status TEXT NOT NULL DEFAULT 'Prospect',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE buyer_contacts (
  id BIGSERIAL PRIMARY KEY, buyer_id BIGINT NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  name TEXT NOT NULL, department TEXT, designation TEXT, mobile_number TEXT, email_address TEXT,
  whatsapp_number TEXT, notes TEXT, is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_buyer_primary_contact ON buyer_contacts(buyer_id) WHERE is_primary;
CREATE TABLE buyer_locations (
  id BIGSERIAL PRIMARY KEY, buyer_id BIGINT NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  name TEXT NOT NULL, gst_number VARCHAR(15), pan VARCHAR(10), address TEXT, city TEXT, state TEXT,
  delivery_preferences TEXT, credit_terms TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE buyer_master_values (
  id BIGSERIAL PRIMARY KEY, master_type TEXT NOT NULL, label TEXT NOT NULL, code TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE, UNIQUE(master_type,label)
);
CREATE TABLE buyer_master_links (
  buyer_id BIGINT NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  master_value_id BIGINT NOT NULL REFERENCES buyer_master_values(id) ON DELETE CASCADE,
  PRIMARY KEY(buyer_id,master_value_id)
);
CREATE TABLE buyer_custom_field_definitions (
  id BIGSERIAL PRIMARY KEY, field_key TEXT NOT NULL UNIQUE, label TEXT NOT NULL, field_type TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]', is_required BOOLEAN DEFAULT FALSE, is_active BOOLEAN DEFAULT TRUE, sort_order INTEGER DEFAULT 0
);
CREATE TABLE buyer_custom_field_values (
  buyer_id BIGINT NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  definition_id BIGINT NOT NULL REFERENCES buyer_custom_field_definitions(id) ON DELETE CASCADE,
  value JSONB, PRIMARY KEY(buyer_id,definition_id)
);
CREATE TABLE buyer_activities (
  id BIGSERIAL PRIMARY KEY, buyer_id BIGINT NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL, description TEXT NOT NULL, metadata JSONB DEFAULT '{}',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, occurred_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_buyers_group_name ON buyers(group_name);
CREATE INDEX idx_buyers_filters ON buyers(state,group_tag,lead_manager,order_status);
CREATE INDEX idx_buyers_followup ON buyers(next_call_date);
CREATE INDEX idx_buyer_locations_buyer ON buyer_locations(buyer_id);
CREATE INDEX idx_buyer_contacts_buyer ON buyer_contacts(buyer_id);
CREATE INDEX idx_buyer_activities_timeline ON buyer_activities(buyer_id,occurred_at DESC);
CREATE OR REPLACE FUNCTION buyer_keep_one_primary_contact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_primary THEN UPDATE buyer_contacts SET is_primary=FALSE,updated_at=now() WHERE buyer_id=NEW.buyer_id AND id<>COALESCE(NEW.id,0) AND is_primary; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_buyer_primary_contact BEFORE INSERT OR UPDATE OF is_primary ON buyer_contacts FOR EACH ROW EXECUTE FUNCTION buyer_keep_one_primary_contact();

-- Complete Supplier procurement and pricing schema.
\ir database-scripts/supplier/001-supplier-module.sql
\ir database-scripts/logistics/001-logistics-module.sql

-- enquiries

-- ensure sequence exists before using in default
CREATE SEQUENCE IF NOT EXISTS enquiry_seq START 1000;

CREATE TABLE enquiries (
  id SERIAL PRIMARY KEY,
  enquiry_no TEXT UNIQUE DEFAULT ('ENQ-' || nextval('enquiry_seq')),
  buyer_id BIGINT REFERENCES buyers(id),
  supplier_id BIGINT REFERENCES suppliers(id),
  chemical TEXT,
  quantity NUMERIC,
  unit TEXT,
  price NUMERIC,
  currency TEXT,
  status TEXT,
  priority TEXT,
  notes TEXT,
  expected_closing_date DATE,
  assigned_user INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now()
);

-- chemicals master
CREATE TABLE chemicals (
  id SERIAL PRIMARY KEY,
  name TEXT,
  cas_number TEXT,
  grade TEXT,
  category TEXT,
  unit TEXT,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE
);

-- followups
CREATE TABLE followups (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  enquiry_id INTEGER REFERENCES enquiries(id),
  comment TEXT,
  followup_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);

-- roles seed: admin
INSERT INTO roles (name, description, permissions) VALUES ('Admin', 'Full access', '{}'::jsonb) RETURNING id;

-- Development admin: admin@cresco.local / Cresco@2026
INSERT INTO users (name, email, password, role_id, is_admin, email_verified) VALUES ('Initial Admin', 'admin@cresco.local', '$2a$10$KRwAemuIZVTpvdgdIvttaOUHcKY336IbQZ9Uutj4mvV4jMuIE1Luq', 1, TRUE, TRUE);
-- indexes
CREATE INDEX idx_users_email ON users(email);

-- end
-- Create the core CRM database schema for Cresco local

-- Keep the first, legacy block compatible with the API field names below.

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  permissions JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  otp_code TEXT,
  otp_expires_at TIMESTAMP WITH TIME ZONE,
  reset_token TEXT,
  reset_expires_at TIMESTAMP WITH TIME ZONE,
  refresh_token TEXT,
  last_login TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  company_name TEXT DEFAULT 'Cresco Global',
  timezone TEXT DEFAULT 'Asia/Kolkata',
  currency TEXT DEFAULT 'INR',
  report_schedule TEXT DEFAULT 'weekly',
  modules JSONB DEFAULT '{"dashboard":true,"buyers":true,"suppliers":true,"logistics":true,"enquiries":true,"reports":true,"settings":true,"users":true,"roles":true,"uploads":true}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chemicals (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cas_number TEXT,
  grade TEXT,
  category TEXT,
  unit TEXT DEFAULT 'MT',
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enquiries (
  id SERIAL PRIMARY KEY,
  enquiry_no TEXT NOT NULL UNIQUE,
  buyer_id BIGINT REFERENCES buyers(id) ON DELETE SET NULL,
  supplier_id BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  chemical TEXT,
  quantity NUMERIC,
  unit TEXT DEFAULT 'MT',
  price NUMERIC,
  currency TEXT DEFAULT 'INR',
  status TEXT DEFAULT 'New',
  priority TEXT DEFAULT 'Normal',
  notes TEXT,
  expected_closing_date DATE,
  assigned_user INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS followups (
  id SERIAL PRIMARY KEY,
  enquiry_id INTEGER REFERENCES enquiries(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  comment TEXT,
  next_followup_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uploads (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending',
  inserted_count INTEGER DEFAULT 0,
  error_message TEXT
);

INSERT INTO roles (name, permissions)
VALUES
  ('Admin', '{"modules": {"dashboard": true, "buyers": true, "suppliers": true, "logistics": true, "enquiries": true, "reports": true, "settings": true, "users": true, "roles": true, "uploads": true}, "actions": {"create": true, "read": true, "update": true, "delete": true}}'),
  ('Manager', '{"modules": {"dashboard": true, "buyers": true, "suppliers": true, "logistics": true, "enquiries": true, "reports": true}, "actions": {"create": true, "read": true, "update": true, "delete": false}}'),
  ('Sales', '{"modules": {"dashboard": true, "buyers": true, "suppliers": true, "logistics": true, "enquiries": true}, "actions": {"create": true, "read": true, "update": true, "delete": false}}')
ON CONFLICT DO NOTHING;

INSERT INTO settings (company_name, timezone, currency, report_schedule)
SELECT 'Cresco Global', 'Asia/Kolkata', 'INR', 'weekly'
WHERE NOT EXISTS (SELECT 1 FROM settings);
