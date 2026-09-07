import ExcelJS from "exceljs";
const rows=[
[1,"Global","Dynamic searchable dropdowns everywhere","Shared SelectField now defaults to searchable","Fixed","N/A","Fixed","Frontend production build passed","Applies to all existing SelectField-based masters"],
[2,"Dashboard","Two sales to-do tables","Added prospect-today and follow-up-due queries and tables","Fixed","Fixed","Fixed","Frontend build + backend syntax check passed","Eligibility uses Prospect, zero orders, and due/blank next-call date"],
[3,"Buyers","Call dates, next call and timestamped remark history","Call remarks now create dated activity records and display in CRM Information","Fixed","Fixed","Fixed","Build/syntax passed","Existing old single remark remains visible; new updates build history"],
[4,"Orders","Buyer field must allow typing/search","Buyer SelectField was already explicitly searchable","Already Fixed","Already Fixed","Already Fixed","Code audit + build passed","Verified, no duplicate implementation"],
[5,"Buyers","Group Overview action at right should link from group name","Existing view action remains available; direct-name hyperlink still pending","Partial","N/A","Partial","Code audit","Client previously marked this fixed; direct group-name link requires final connection"],
[6,"Authentication","Re-login popup","Added blocking session-expired dialog with Log in again action in addition to existing toast/redirect","Fixed","Already Fixed","Fixed","Frontend production build passed","ToastProvider.jsx"],
[7,"Suppliers","Supplier overview editable","Supplier PUT API and Edit action already implemented","Already Fixed","Already Fixed","Already Fixed","Code audit","Client says point 7 was previously fixed; verified"],
[8,"Suppliers","Contacts editable/deletable; blank blocked","Edit/delete controls connected to contact PUT/DELETE APIs; name and contact-detail blank checks added","Fixed","Fixed","Fixed","Frontend build + backend syntax passed","Vendors.jsx, suppliers route/controller/service"],
[9,"Suppliers","Warehouses editable/deletable; blank blocked","Edit/delete UI and APIs added; warehouse name/address/district/pincode required","Fixed","Fixed","Fixed","Frontend build + backend syntax passed","Warehouse deletion still respects database reference constraints"],
[10,"Suppliers","Warehouse code, district and pincode","Production migration and forms add searchable logistics-ready warehouse master fields","Fixed","Fixed","Fixed","Migration reviewed + frontend build passed","Migration must run before deploying new backend"],
[11,"Suppliers","Payment terms and bank/account should not belong to warehouse","New warehouse UI/API no longer captures commercial terms; legacy columns retained only to preserve old data","Fixed","Fixed","Fixed","Code and migration audit","Payment/bank/account remain deal/procurement transaction data"],
[12,"Suppliers","Categories edit/delete; grade pricing undo/redo and factors","Category APIs and undo/redo exist; factor database model added; management UI remains","Partial","Partial","Partial","Build/syntax and schema audit","Factor UI and category action controls pending"],
[13,"Logistics","Freight routes Excel bulk upload","Template/import workflow not connected yet","Pending","Pending","Pending","Not implemented","Required before production sign-off"],
[14,"Logistics","Transporter Excel bulk upload","Template/import workflow not connected yet","Pending","Pending","Pending","Not implemented","Required before production sign-off"],
[15,"Logistics","Warehouse/district/pincode searchable and auto-filled","Warehouse master API now exposes supplier, code, address, district and pincode; pincode-first lane UI remains","Partial","Fixed","Partial","Frontend build + backend syntax passed","Migration adds missing normalized fields"],
[16,"Validation","PAN/GST/phone/email/pincode validations","Supplier and transporter APIs normalize PAN/GST uppercase and validate identity/contact/pincode values","Partial","Fixed","Partial","Backend syntax passed","Buyer/supplier/transporter UI consistency and bulk-import validation still being completed"],
[17,"Logistics","Transporter editable/deletable","Update and delete APIs exist; edit/delete profile controls remain to connect","Pending","Fixed","Partial","Backend syntax passed","Deletion blocks transporters with historical references"],
[18,"Logistics","Configurable lane-note dropdowns","Database master table added; settings and lane-form UI remain","Pending","Fixed","Partial","Migration reviewed","logistics_lane_note_options"],
[19,"Logistics","Warehouse codes","Warehouse code schema, uniqueness rule, supplier form and logistics master response added","Fixed","Fixed","Fixed","Build/syntax passed","Legacy warehouses can be assigned codes during edit"],
[20,"Freight Cost Register","Shipment ID alphanumeric","Separate user-facing alphanumeric shipment_code added without breaking numeric foreign keys; API accepts code lookup","Pending UI","Fixed","Partial","Migration + backend syntax passed","Cost form searchable shipment-code dropdown remains"],
[21,"Database","Production compatibility migration","Idempotent migration adds required fields/tables and preserves legacy commercial data","N/A","Fixed","Fixed","SQL reviewed","003-client-production-enhancements.sql must be applied before backend deployment"]
];
const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet("CRM Change Status");
ws.columns=["No","Module","Client Request","Analysis","FE Status","BE Status","Final Status","Verification","Notes / Clarification"].map((header,i)=>({header,key:String(i),width:[7,18,42,48,16,16,20,28,55][i]}));
rows.forEach(r=>{const row={};r.forEach((v,i)=>row[String(i)]=v);ws.addRow(row)});
ws.views=[{state:"frozen",ySplit:1}];ws.autoFilter={from:"A1",to:"I1"};ws.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};ws.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF0F4C5C"}};
ws.eachRow((row,n)=>{
  row.alignment={vertical:"top",wrapText:true};
  if(n>1){
    const s=row.getCell(7),colors={Fixed:"FFC6EFCE","Already Fixed":"FFD9EAF7",Partial:"FFFFEB9C",Pending:"FFF4CCCC","Needs Clarification":"FFEADCF8"};
    s.fill={type:"pattern",pattern:"solid",fgColor:{argb:colors[s.value]||"FFFFFFFF"}};
  }
});
await wb.xlsx.writeFile(new URL("../../CRM-Client-Changes-Report.xlsx",import.meta.url));
