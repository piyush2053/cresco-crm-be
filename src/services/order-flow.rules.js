// Shared, dependency-free schemas. All quantities are kg; prices are INR/kg.
export const stages = [
  ['1', 'Enquiry Received', { contact: 'text', phone: 'phone', packing: ['Bags','Drums','Bulk'], delivery_address: 'text', payment_terms: ['Advance','Against delivery','Credit'], credit_days: 'nonnegative', required_delivery: 'date?', delivered_price:'positive?', price_reason:'text?' }],
  ['2', 'Quotation Sent', { validity: 'date', payment_terms: ['Advance','Against delivery','Credit'], delivery_terms: ['Delivered','Door','Godown'], send_via: ['Email','WhatsApp','Download'], remarks: 'text?' }],
  ['3', 'Order Confirmed', { buyer_po: 'text', quantity_kg: 'positive', delivered_price: 'positive', credit_days: 'nonnegative', gst_number: 'text', billing_address: 'text', gst_percent: 'nonnegative', price_reason: 'text?' }],
  ['3A', 'Payment Check', { amount: 'positive?', payment_date: 'date?', mode: ['Bank transfer','UPI','Cheque'], bank_reference: 'text?', override_reason: 'text?' }],
  ['4', 'Supplier Confirmed', { suppliers: 'suppliers' }],
  ['5', 'Transporter Confirmed', { transporter_id: 'positive', freight: 'nonnegative', freight_basis: ['Per kg','Per trip'], vehicle_type: ['Truck','Container','Tanker'], door_delivery: ['Yes','No'], contact: 'text', payment_terms: ['Advance','To-pay','After delivery'], freight_reason: 'text?' }],
  ['6', 'Dispatch Date Confirmed', { dispatch_date: 'date', confirmed_by: 'text', transit_days: 'nonnegative', loading_window: 'text?' }],
  ['7', 'Vehicle Confirmed', { vehicles: 'vehicles' }],
  ['8', 'Vehicle Reached Godown', { arrival: 'datetime' }],
  ['9', 'Vehicle Loading', { loading_start: 'datetime', remarks: 'text?' }],
  ['10', 'Vehicle Loaded', { loading_end: 'datetime', loaded_quantity: 'positive', package_count: 'positive', seal: 'text?', quantity_reason: 'text?' }],
  ['11', 'Supplier Invoice Received', { invoices: 'invoices', mismatch_reason: 'text?' }],
  ['12', 'Dispatched', { dispatch_time: 'datetime', lr_number: 'text', invoice_date: 'date', einvoice_number: 'text?', notify_buyer: ['Yes','No'] }],
  ['13', 'In Transit', { location: 'text?', expected_arrival: 'date?', delay_reason: 'text?' }],
  ['14', 'Delivered', { delivered_at: 'datetime', received_quantity: 'positive', shortage_damage_reason: 'text?' }],
].map(([id, name, fields]) => ({ id, name, fields, group:id==='3A'?'Finance':+id<=3?'Sales':+id===4?'Supply':+id<=10?'Logistics':+id<=12?'Billing':'Delivery' }));

export const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const schemaFor = id => stages.find(s => s.id === id) || fail('Unknown stage.');
const nested = {
  suppliers: { supplier_id: 'positive', quantity_kg: 'positive', rate: 'positive', basis: ['Ex-works','Delivered'], ready_date: 'date', pickup_address: 'text', contact: 'text' },
  vehicles: { supplier_id:'positive', number: 'vehicle', driver: 'text', phone: 'phone', length_m: 'positive', width_m: 'positive', height_m: 'positive', capacity_kg: 'positive', allocated_kg: 'positive', dispatch_date: 'date' },
  invoices: { supplier_id: 'positive', number: 'text', date: 'date', quantity_kg: 'positive', rate: 'positive', taxable: 'nonnegative', gst: 'nonnegative', total: 'positive', eway_number: 'text' },
};
export const nestedSchemas = nested;
export function validate(fields, input, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Fields must be an object.');
  const output = {};
  for (const key of Object.keys(input)) if (!(key in fields)) fail(`Unknown field: ${key}.`);
  for (const [key, rule] of Object.entries(fields)) {
    let value = input[key];
    if (value === undefined || value === null || value === '') {
      if (partial || String(rule).endsWith('?') || key === 'mode') continue;
      fail(`${key} is required.`);
    }
    if(partial && !nested[rule]) {
      if(!['string','number'].includes(typeof value)||String(value).length>4000)fail(`Invalid ${key}.`);
      output[key]=value;continue;
    }
    if (Array.isArray(rule)) { if (!rule.includes(value)) fail(`Invalid ${key}.`); }
    else if (nested[rule]) {
      if (!Array.isArray(value) || !value.length || value.length > 100) fail(`Invalid ${key}.`);
      value = value.map(row => validate(nested[rule], row, partial));
    } else {
      const type = rule.replace('?', '');
      if (['positive','nonnegative'].includes(type)) {
        if (!['string','number'].includes(typeof value) || !Number.isFinite(Number(value)) || Number(value) < 0 || (type === 'positive' && Number(value) === 0)) fail(`Invalid ${key}.`);
        value = Number(value);
      } else {
        if (typeof value !== 'string' || !value.trim() || value.length > 4000) fail(`Invalid ${key}.`);
        value = value.trim();
        if (type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) fail(`Invalid ${key}.`);
        if (type === 'datetime' && (!/T/.test(value) || !Number.isFinite(Date.parse(value)))) fail(`Invalid ${key}.`);
        if (type === 'phone' && !/^\+?[\d ()-]{7,20}$/.test(value)) fail(`Invalid ${key}.`);
        if (type === 'vehicle' && !/^[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{0,3}[ -]?\d{4}$/i.test(value)) fail('Invalid vehicle number.');
      }
    }
    output[key] = value;
  }
  return output;
}
export function transition(current, target, action, admin, manager, reason) {
  const from = stages.findIndex(s => s.id === current), to = stages.findIndex(s => s.id === target);
  if (to < 0) fail('Unknown stage.');
  if (action === 'back') { if (!manager || !reason?.trim() || to >= from) fail('Manager and reason required for a back-step.', 403); return; }
  if (action === 'edit') { if (to > from) fail('Cannot edit a future stage.'); if (to < from && (!manager || !reason?.trim())) fail('Manager approval and reason required.', 403); return; }
  if (action === 'skip') { if (!admin || !reason?.trim() || to <= from) fail('Admin and reason required to skip.', 403); return; }
  if (to !== from + 1) fail('Complete the next stage in sequence.', 409);
}
export const creditResult = (limit, outstanding, open, value) => ({ limit, outstanding, open, available: limit - outstanding - open, value, passed: limit - outstanding - open >= value });
export const deliveredPrice = (master, freight) => { if (master == null || freight == null) fail('Latest master price and route freight are required.'); return Number(master) + Number(freight); };
export function capacity(vehicles, quantity, volume) {
  if (Math.abs(vehicles.reduce((n,v) => n + v.allocated_kg, 0)-quantity)>0.001) fail('Vehicle allocations must equal ordered kg.');
  if (new Set(vehicles.map(v => v.number.toUpperCase().replaceAll(' ',''))).size !== vehicles.length) fail('Duplicate vehicle.');
  if (vehicles.some(v => v.allocated_kg > v.capacity_kg)) fail('Load exceeds vehicle weight capacity; add another vehicle.');
  if (vehicles.some(v => v.length_m*v.width_m*v.height_m < volume*v.allocated_kg/quantity)) fail('Load exceeds vehicle volume; add another vehicle.');
  if (vehicles.reduce((n,v) => n + v.length_m*v.width_m*v.height_m,0) < volume) fail('Load exceeds vehicle volume; add another vehicle.');
}
