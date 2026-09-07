import ExcelJS from "exceljs";
const rows=[
[1,"Global","Dynamic searchable dropdowns everywhere","Shared SelectField now defaults to searchable","Fixed","N/A","Fixed","Frontend production build passed","Applies to all existing SelectField-based masters"],
[2,"Dashboard","Two sales to-do tables","Added prospect-today and follow-up-due queries and tables","Fixed","Fixed","Fixed","Frontend build + backend syntax check passed","Eligibility uses Prospect, zero orders, and due/blank next-call date"],
[3,"Buyers","Call dates, next call and timestamped remark history","Call remarks now create dated activity records and display in CRM Information","Fixed","Fixed","Fixed","Build/syntax passed","Existing old single remark remains visible; new updates build history"],
[4,"Orders","Buyer field must allow typing/search","Buyer SelectField was already explicitly searchable","Already Fixed","Already Fixed","Already Fixed","Code audit + build passed","Verified, no duplicate implementation"],
[5,"Buyers","Group Overview action at right should link from group name","Existing view action already present; direct-name link still needs final UX confirmation","Partial","N/A","Partial","Code audit","Client says point 5 was previously fixed; preserved current behaviour"],
[6,"Authentication","Re-login popup","Session-expiry detection and re-login message already implemented","Already Fixed","Already Fixed","Already Fixed","api.js audit","Global modal redirect can be added if popup means a blocking dialog"],
[7,"Suppliers","Supplier overview editable","Supplier PUT API and Edit action already implemented","Already Fixed","Already Fixed","Already Fixed","Code audit","Client says point 7 was previously fixed; verified"],
[8,"Suppliers","Contacts editable/deletable; blank blocked","API CRUD added; blank contact validation added","Pending UI","Fixed","Partial","Backend syntax passed","UI edit/delete controls remain to connect"],
[9,"Suppliers","Warehouses editable/deletable; blank blocked","API CRUD added; name/address validation; payment terms removed from new warehouse capture","Pending UI","Fixed","Partial","Backend syntax passed","Database legacy fields retained for compatibility"],
[10,"Suppliers","Categories edit/delete; grade pricing undo/redo and factors","Category APIs and undo/redo already exist; UI category actions/factor model incomplete","Partial","Already Fixed","Partial","Code audit","Needs definition of factor formula and scope"],
[11,"Logistics","Freight and transporter Excel bulk upload","No safe shared template/mapping specified","Pending","Pending","Needs Clarification","Not implemented","Need approved Excel columns and duplicate/upsert rules"],
[12,"Logistics","Warehouse/district/pincode searchable and auto-filled","Search exists; warehouse master payload expanded; full pincode pivot incomplete","Partial","Partial","Partial","Build/syntax passed","Supplier warehouse schema lacks dedicated district/pincode columns"],
[13,"Validation","PAN/GST/phone/email/pincode validations","Buyer bulk validation exists; remaining manual/transporter coverage incomplete","Partial","Partial","Partial","Code audit","Must be applied consistently to all modules and imports"],
[14,"Logistics","Transporter editable/deletable and bulk add","Delete API exists; edit and bulk import incomplete","Pending","Partial","Partial","Code audit","Deletion correctly blocks referenced history"],
[15,"Logistics","Configurable lane-note dropdowns and warehouse codes","Requires master-data/schema design","Pending","Pending","Needs Clarification","Not implemented","Define who manages values and required warehouse-code format"],
[16,"Freight Cost Register","Shipment ID alphanumeric","Current DB uses numeric FK to shipment; client likely means external shipment reference","Pending","Pending","Needs Clarification","Schema audit","Add separate shipment_code text rather than breaking relational ID"]
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
