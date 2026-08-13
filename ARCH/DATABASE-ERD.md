# Cresco CRM Database ERD

![Cresco CRM PostgreSQL domain ERD](./cresco-crm-database-erd.png)

The database is split into related business domains. The diagrams emphasize primary business relationships rather than every audit/configuration column. SQL files in `db-init.sql`, `db-modules.sql`, and `database-scripts/` remain the authoritative schema.

## Domain map

```mermaid
flowchart LR
  identity[Identity & Access\nroles, users, sessions]
  buyer[Buyer CRM\nbuyers, contacts, locations]
  supplier[Supplier & Procurement\nsuppliers, warehouses, pricing]
  sales[Sales & Orders\nenquiries, orders, products, documents]
  logistics[Logistics\nlanes, slabs, transport pricing]
  finance[Finance\ncommercials, invoices, payments, delays]
  reporting[Reports & Notifications\nBI definitions, schedules, runs]
  settings[Settings & Logic Engine\nmasters, approvals, formulas]

  identity --> buyer
  identity --> supplier
  buyer --> sales
  supplier --> sales
  supplier --> logistics
  logistics --> sales
  sales --> finance
  identity --> finance
  sales --> reporting
  finance --> reporting
  identity --> settings
  settings --> sales
  settings --> finance
```

## Identity and CRM core

```mermaid
erDiagram
  ROLES ||--o{ USERS : grants
  USERS ||--o{ USER_CRM_SESSIONS : opens
  USERS ||--o{ NOTIFICATIONS : receives
  USERS ||--o{ BUYER_ACTIVITIES : creates
  USERS ||--o{ FOLLOWUPS : owns
  USERS ||--o{ ENQUIRIES : assigned

  BUYERS ||--o{ BUYER_CONTACTS : has
  BUYERS ||--o{ BUYER_LOCATIONS : has
  BUYERS ||--o{ BUYER_ACTIVITIES : records
  BUYERS ||--o{ BUYER_MASTER_LINKS : classified_by
  BUYER_MASTER_VALUES ||--o{ BUYER_MASTER_LINKS : links
  BUYERS ||--o{ BUYER_CUSTOM_FIELD_VALUES : has
  BUYER_CUSTOM_FIELD_DEFINITIONS ||--o{ BUYER_CUSTOM_FIELD_VALUES : defines
  BUYER_CONTACTS }o--o{ BUYER_LOCATIONS : contact_locations

  BUYERS ||--o{ ENQUIRIES : raises
  SUPPLIERS ||--o{ ENQUIRIES : supplies
  ENQUIRIES ||--o{ FOLLOWUPS : has
  USERS ||--o{ LEADS : assigned

  ROLES { int id PK string name jsonb permissions }
  USERS { int id PK int role_id FK string email boolean is_active }
  BUYERS { bigint id PK string buyer_code string company_name }
  BUYER_CONTACTS { bigint id PK bigint buyer_id FK string name }
  BUYER_LOCATIONS { bigint id PK bigint buyer_id FK string location_name }
  ENQUIRIES { int id PK bigint buyer_id FK bigint supplier_id FK int assigned_user FK }
  FOLLOWUPS { int id PK int enquiry_id FK int user_id FK date next_followup_date }
```

## Suppliers, logistics and orders

```mermaid
erDiagram
  SUPPLIERS ||--o{ SUPPLIER_CONTACTS : has
  SUPPLIERS ||--o{ SUPPLIER_WAREHOUSES : operates
  SUPPLIER_WAREHOUSES ||--o{ SUPPLIER_PRODUCT_CATEGORIES : stocks
  SUPPLIER_PRODUCT_CATEGORIES ||--o{ SUPPLIER_GRADES : offers
  SUPPLIER_GRADES ||--o{ SUPPLIER_GRADE_PRICES : priced_by
  SUPPLIER_GRADE_PRICES ||--o{ SUPPLIER_PRICE_CELL_HISTORY : audited_by
  SUPPLIERS ||--o{ SUPPLIER_DOCUMENTS : owns
  SUPPLIERS ||--o{ SUPPLIER_ACTIVITIES : records

  SUPPLIER_WAREHOUSES ||--o{ LOGISTICS_LANES : pickup_from
  LOGISTICS_LANES ||--o{ ORDERS : selected_for
  BUYERS ||--o{ ORDERS : places
  SUPPLIERS ||--o{ ORDERS : fulfills
  BUYERS ||--o{ SALES_TRANSACTIONS : raises
  SALES_TRANSACTIONS ||--o{ SALES_TRANSACTION_PRODUCTS : contains
  SALES_TRANSACTIONS ||--o{ SALES_QUOTE_REVISIONS : revises
  SALES_TRANSACTIONS ||--o{ SALES_STAGE_HISTORY : progresses
  SALES_TRANSACTIONS ||--o{ SALES_COMMUNICATIONS : records
  SALES_TRANSACTIONS ||--o{ SALES_DOCUMENTS : produces
  SUPPLIER_WAREHOUSES ||--o{ SALES_TRANSACTION_PRODUCTS : dispatches
  LOGISTICS_LANES ||--o{ SALES_TRANSACTION_PRODUCTS : priced_for
  SUPPLIERS ||--o{ SALES_TRANSACTION_PRODUCTS : preferred

  BUYERS ||--o{ PROCUREMENT_PREFERENCES : configures
  SUPPLIERS ||--o{ PROCUREMENT_PREFERENCES : preferred
  SUPPLIER_WAREHOUSES ||--o{ PROCUREMENT_PREFERENCES : dispatches

  SUPPLIERS { bigint id PK string supplier_code string company_name }
  SUPPLIER_WAREHOUSES { bigint id PK bigint supplier_id FK string warehouse_name }
  LOGISTICS_LANES { bigint id PK bigint pickup_warehouse_id FK string lane_code }
  ORDERS { bigint id PK bigint buyer_id FK bigint supplier_id FK bigint logistics_lane_id FK string order_number }
  SALES_TRANSACTIONS { bigint id PK bigint buyer_id FK string inquiry_number string current_stage }
  SALES_TRANSACTION_PRODUCTS { bigint id PK bigint transaction_id FK string product_category numeric quantity_kg }
```

## Finance and delayed payments

```mermaid
erDiagram
  ORDERS ||--|| FINANCE_COMMERCIAL_RECORDS : commercialized_as
  SALES_TRANSACTIONS ||--o| FINANCE_COMMERCIAL_RECORDS : references
  FINANCE_COMMERCIAL_RECORDS ||--o{ FINANCE_RECEIVABLE_INVOICES : bills
  FINANCE_COMMERCIAL_RECORDS ||--o{ FINANCE_DOCUMENTS : has
  FINANCE_COMMERCIAL_RECORDS ||--o{ FINANCE_TIMELINE : records
  BUYERS ||--o{ FINANCE_RECEIVABLE_INVOICES : owes
  SUPPLIERS ||--o{ FINANCE_PAYABLE_INVOICES : is_owed
  FINANCE_PAYABLE_INVOICES }o--o{ ORDERS : payable_order_links
  BUYERS ||--o{ FINANCE_CUSTOMER_PAYMENTS : pays
  FINANCE_CUSTOMER_PAYMENTS }o--o{ FINANCE_RECEIVABLE_INVOICES : receipt_allocations
  SUPPLIERS ||--o{ FINANCE_SUPPLIER_PAYMENTS : paid
  FINANCE_SUPPLIER_PAYMENTS }o--o{ FINANCE_PAYABLE_INVOICES : payment_allocations

  FINANCE_RECEIVABLE_INVOICES ||--|| DELAYED_PAYMENT_ACCOUNTS : monitored_by
  DELAYED_PAYMENT_ACCOUNTS ||--o{ DELAYED_PAYMENT_ACCRUALS : accrues
  DELAYED_PAYMENT_ACCOUNTS ||--o{ DELAYED_PAYMENT_DEBIT_NOTES : produces
  DELAYED_PAYMENT_ACCOUNTS ||--o{ DELAYED_PAYMENT_AUDIT : audited_by
  DELAYED_PAYMENT_DEBIT_NOTES ||--o{ DELAYED_PAYMENT_AUDIT : audited_by

  ORDERS { bigint id PK string order_number }
  FINANCE_COMMERCIAL_RECORDS { bigint id PK bigint order_id FK bigint transaction_id FK string commercial_number }
  FINANCE_RECEIVABLE_INVOICES { bigint id PK bigint commercial_id FK bigint buyer_id FK date due_date numeric invoice_value }
  FINANCE_PAYABLE_INVOICES { bigint id PK bigint supplier_id FK date due_date numeric purchase_value }
  DELAYED_PAYMENT_ACCOUNTS { bigint id PK bigint receivable_id FK bigint buyer_id FK bigint order_id FK date due_date }
  DELAYED_PAYMENT_ACCRUALS { bigint id PK bigint account_id FK date accrual_date numeric daily_charge }
  DELAYED_PAYMENT_DEBIT_NOTES { bigint id PK bigint account_id FK string status numeric amount }
```

## Procurement working capital

```mermaid
erDiagram
  PROCUREMENT_BANKS ||--o{ PROCUREMENT_BANK_ACCOUNTS : owns
  PROCUREMENT_BANK_ACCOUNTS ||--o{ PROCUREMENT_CC_RATE_HISTORY : rates
  SUPPLIERS ||--o{ SUPPLIER_PROCUREMENT_TRANSACTIONS : receives
  SUPPLIER_WAREHOUSES ||--o{ SUPPLIER_PROCUREMENT_TRANSACTIONS : dispatches
  ORDERS ||--o{ SUPPLIER_PROCUREMENT_TRANSACTIONS : funds
  SALES_TRANSACTIONS ||--o{ SUPPLIER_PROCUREMENT_TRANSACTIONS : relates
  PROCUREMENT_BANKS ||--o{ SUPPLIER_PROCUREMENT_TRANSACTIONS : financed_by
  PROCUREMENT_BANK_ACCOUNTS ||--o{ SUPPLIER_PROCUREMENT_TRANSACTIONS : drawn_from
  SUPPLIER_PROCUREMENT_TRANSACTIONS ||--o{ SUPPLIER_PROCUREMENT_AUDIT : audited_by

  PROCUREMENT_BANKS { bigint id PK string name }
  PROCUREMENT_BANK_ACCOUNTS { bigint id PK bigint bank_id FK string account_number }
  PROCUREMENT_CC_RATE_HISTORY { bigint id PK bigint account_id FK numeric annual_rate }
  SUPPLIER_PROCUREMENT_TRANSACTIONS { bigint id PK bigint supplier_id FK bigint warehouse_id FK bigint order_id FK }
```

## Reporting, settings and business logic

```mermaid
erDiagram
  BI_REPORT_DEFINITIONS ||--o{ BI_REPORT_SCHEDULES : scheduled_as
  BI_REPORT_DEFINITIONS ||--o{ BI_REPORT_RUNS : executed
  BI_REPORT_SCHEDULES ||--o{ BI_REPORT_RUNS : triggers
  USERS ||--o{ BI_REPORT_RUNS : runs

  SETTINGS_MASTER_TYPES ||--o{ SETTINGS_MASTER_RECORDS : contains
  SETTINGS_MASTER_RECORDS ||--o{ SETTINGS_MASTER_RECORDS : parent_of
  SETTINGS_APPROVAL_WORKFLOWS ||--o{ SETTINGS_APPROVAL_LEVELS : contains
  ROLES ||--o{ SETTINGS_APPROVAL_LEVELS : approves
  ROLES ||--o{ SETTINGS_ACCESS_PERMISSIONS : receives

  LOGIC_OBJECTS ||--o{ LOGIC_VERSIONS : versions
  LOGIC_OBJECTS o|--o| LOGIC_VERSIONS : current_version
  LOGIC_OBJECTS o|--o| LOGIC_VERSIONS : live_version
  LOGIC_OBJECTS ||--o{ LOGIC_CALCULATION_SNAPSHOTS : calculates
  LOGIC_VERSIONS ||--o{ LOGIC_CALCULATION_SNAPSHOTS : evaluates_with
  LOGIC_OBJECTS ||--o{ LOGIC_EVALUATION_LOG : logs
  LOGIC_OPTION_SETS ||--o{ LOGIC_OPTIONS : contains
  LOGIC_OPTIONS ||--o{ LOGIC_OPTIONS : parent_of
  USERS ||--o{ LOGIC_SAVED_VIEWS : owns

  BI_REPORT_DEFINITIONS { bigint id PK string name string data_source }
  BI_REPORT_SCHEDULES { bigint id PK bigint report_id FK string cron_expression }
  SETTINGS_MASTER_TYPES { bigint id PK string code string category }
  SETTINGS_MASTER_RECORDS { bigint id PK bigint master_type_id FK bigint parent_id FK jsonb data }
  LOGIC_OBJECTS { bigint id PK bigint current_version_id FK bigint live_version_id FK string module_key }
  LOGIC_VERSIONS { bigint id PK bigint object_id FK int version_number string expression }
```

## Schema ownership notes

- Foreign keys commonly use `ON DELETE CASCADE` for owned child data and `SET NULL`/`RESTRICT` for auditable business records.
- `users` and `roles` are shared across nearly every domain for ownership, approval, and audit metadata.
- JSONB is deliberately used for configurable permissions, master data, rule definitions, templates, and calculation inputs/results.
- Join tables implement many-to-many allocation and classification relationships.
- Migration order matters: core identity and master entities must exist before orders, finance, reporting, and logic-engine migrations.
