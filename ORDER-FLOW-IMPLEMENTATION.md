# Order flow implementation

## Architecture and impact

The existing Express/pg services and React UI remain in use. No dependencies were added. `order-flow.rules.js` defines the 14 numbered stages plus the 3A finance gate, input schemas, transition rules and calculation helpers. `order-flow.service.js` owns flow records, transactions, row locking, optimistic versions, idempotency, audit records and credit decisions. The existing order router supplies authentication and module permissions; the flow service additionally enforces stage roles and update permission. Margin fields are removed recursively from order API responses unless permitted.

The React `OrderFlow` component supplies the stage tracker, stage forms, draft saving, history, approval actions and margin tab. `OrderFlowList` supplies stage/buyer/supplier/delay/today filters. Existing master price viewing, editing and deactivation remain available. The order module's upload endpoints and upload UI were removed. Buyer and Supplier source files were not changed; order services no longer write Buyer aggregates.

## Migration and rollback

Apply `database-scripts/orders/008-order-flow.sql` before deploying the application. The fresh-install SQL includes it. It creates only order-flow tables, indexes and guards on the existing transaction/product tables. It does not modify Buyer or Supplier schemas. It is safe to reapply. It has **not** been applied to the configured `cresco_prod` database.

Existing transactions retain their stages. An order team member or manager explicitly enrolls an unconverted, single-material enquiry through its Order Flow tab. Enrollment preserves the legacy stage/status and starts at stage 0, so required PRD information must be supplied before advancing. Existing converted orders and multi-material enquiries continue in the legacy workflow. Several supplier allocations, vehicles with individual dispatch dates, and supplier invoices are supported within an enrolled order.

Every save locks the flow row and checks `version`. Clients supply a unique `request_key`; replays with the same actor and payload return the committed result. Credit decisions additionally take a per-buyer transaction advisory lock. Guards reject legacy stage/product mutations after enrollment. Flow stage/status changes are reflected in `sales_transactions` for existing read-only consumers. Manager edits to earlier stages invalidate downstream flow data, records and pending communications, requiring validation again.

Rollback: first stop the new application/workers and export all `order_flow_*` records. Then run `database-scripts/orders/rollback/008-order-flow.sql` and deploy the previous application. This removes new flow records and guards and restores each enrolled enquiry's pre-enrollment stage/status. It preserves existing order, Buyer and Supplier data. Previously sent messages cannot be recalled.

## Operations and assumptions

- Roles follow existing role names: `Order Team` / `Order Management`, `Sales`, `Accounts`, `Manager`, plus `users.is_admin`. Existing module update permissions must also allow the action. Accounts and admins see margin; other roles need `roles.permissions.orders.margin=true`.
- Existing masters price by category/grade and freight by districts/quantity. No supplier-region price or vehicle-type freight master exists, so this implementation uses those existing dimensions. Latest currently effective prices are used; future prices are excluded. Supplier suggestions prioritize an exact dispatch-location/delivery-district name match, then current purchase price; geographic distance is not available.
- Quantities and capacities are kg; monetary rates are INR/kg. Freight per trip means the total booking charge for this order. Freight payer is always Cresco. Vehicle dimensions are metres. Packing volume defaults to 0.002 m³/kg and must be configured for the business before rollout.
- `order_flow_settings` contains quantity tolerance (default 2%), packing volume factor, and stage-age threshold (default 3 days). Dispatch transit days are entered per order because the existing route master has no transit-days field.
- Any positive advance up to the order value passes the payment gate. The account reference, date and mode remain mandatory. Credit includes finance outstanding, legacy open orders and reserved flow orders. Unposted buyer invoices remain reserved until their invoice number appears in the finance receivables view, avoiding an exposure gap. Finance posting remains in the existing finance module; the new flow does not create legacy commercial/receivable rows automatically.
- Buyer invoices use loaded quantity and locked price; totals are calculated server-side. Supplier invoice mismatches require acknowledgement through a reason. Earlier-stage edits rewind downstream checks instead of retaining approvals against changed values.
- Follow-up and claim tasks are stored on the order. The five-minute outbox sends requested quotation/dispatch emails through existing SMTP and sends internal task/alert notifications. SMTP delivery is at least once; five failed attempts mark a task failed. A missing email address fails visibly in the task status. WhatsApp delivery is a manual sharing task because the repo has no WhatsApp provider. No real email was sent during tests.
- Stage-age alerts use stage entry time; drafts and unrelated edits do not reset it. Email/WhatsApp provider acceptance and browser interaction still require staging acceptance testing.
- New flow order numbers reuse the enquiry number to retain existing references. The dedicated flow list returns at most the newest 200 matching records; filters narrow the result.

## Files and PDFs deliberately skipped

No upload inputs, proofs, photos, file copies, document table, file blobs or new storage integration were added. The Documents tab was removed. Existing historical document storage/read code is retained for backward compatibility; the new flow never writes it.

The existing quotation/proforma HTML generator is reused for on-demand quotation previews and browser print-to-PDF, without persistence. No new purchase-order, transporter-slip, vehicle-sheet or buyer-invoice PDF generator was added. Buyer invoice records and numbers are created as structured data. Government e-invoice/e-way numbers are entered manually.

## Validation

Run `npm run test:order-flow` for the rules tests. PostgreSQL integration is opt-in: set `ORDER_FLOW_DB_TEST=1`, then run that command. The integration suite opens a dedicated connection, sets its search path to a temporary schema, creates temporary fixtures and applies an adapted migration there. It tests the full advance flow, finance blocking/override, rollback of partial writes, versions, idempotency, role denial, drafts, price audits, legacy bypass guards, outbox delivery through a fake mail transport, migration reapplication and rollback. It does not change persistent database tables or send messages.

Frontend validation: `npx eslint src/pages/Orders.jsx src/components/OrderFlow.jsx src/components/OrderFlowList.jsx` and `npm run build`. Backend validation: `npm run check`. These repositories are JavaScript and have no configured typecheck command.

Full frontend lint has pre-existing `react-hooks/set-state-in-effect` failures in `EmailNotificationRules.jsx` and `FreightBulkUpload.jsx`. Those unrelated files remain untouched. The production bundle also reports its existing large-chunk warning.
