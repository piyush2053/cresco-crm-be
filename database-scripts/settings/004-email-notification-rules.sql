BEGIN;
CREATE TABLE IF NOT EXISTS settings_email_notification_rules (
 id BIGSERIAL PRIMARY KEY,event_key TEXT NOT NULL UNIQUE,event_name TEXT NOT NULL,category TEXT NOT NULL,description TEXT,
 email_enabled BOOLEAN NOT NULL DEFAULT FALSE,in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
 recipient_mode TEXT NOT NULL DEFAULT 'Admins' CHECK(recipient_mode IN('Admins','Actor','Custom')),
 custom_recipients JSONB NOT NULL DEFAULT '[]',is_system BOOLEAN NOT NULL DEFAULT TRUE,
 updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO settings_email_notification_rules(event_key,event_name,category,description,email_enabled,in_app_enabled,recipient_mode) VALUES
('user_login','User Login','Security','Sent after a successful CRM login.',TRUE,TRUE,'Admins'),
('user_created','User Created','Security','Sent when an administrator creates a CRM user.',TRUE,TRUE,'Admins'),
('password_reset','Password Reset Request','Security','Reset instructions sent to the requesting user.',TRUE,FALSE,'Actor'),
('monthly_business_report','Monthly Business Report','Reports','Buyer, supplier and order workbook sent monthly.',TRUE,TRUE,'Admins'),
('scheduled_bi_report','Scheduled BI Report','Reports','Configured BI report delivery. Schedule recipients take priority.',TRUE,FALSE,'Custom'),
('sales_stage_updated','Sales Stage Updated','Operations','Sent when a sales transaction changes stage.',FALSE,TRUE,'Admins'),
('customer_payment_received','Customer Payment Received','Finance','Sent when a customer receipt is recorded.',FALSE,TRUE,'Admins'),
('debit_note_approval','Debit Note Approval Pending','Finance','Sent when a delayed-payment debit note needs approval.',FALSE,TRUE,'Admins'),
('supplier_prices_expiring','Supplier Prices Expiring','Operations','Daily alert for supplier prices expiring within 12 hours.',FALSE,TRUE,'Admins'),
('payments_overdue','Payments Overdue','Finance','Daily alert when receivables are overdue.',FALSE,TRUE,'Admins'),
('orders_delayed','Orders Delayed','Operations','Daily alert when orders pass expected delivery.',FALSE,TRUE,'Admins'),
('database_housekeeping','Database Housekeeping','System','Bi-monthly database retention completion alert.',FALSE,TRUE,'Admins')
ON CONFLICT(event_key) DO UPDATE SET event_name=EXCLUDED.event_name,category=EXCLUDED.category,description=EXCLUDED.description;
COMMIT;
