import { query } from "../db.js";

export const INDIA_GST_STATES = [
  ["01","Jammu and Kashmir"],["02","Himachal Pradesh"],["03","Punjab"],["04","Chandigarh"],
  ["05","Uttarakhand"],["06","Haryana"],["07","Delhi"],["08","Rajasthan"],["09","Uttar Pradesh"],
  ["10","Bihar"],["11","Sikkim"],["12","Arunachal Pradesh"],["13","Nagaland"],["14","Manipur"],
  ["15","Mizoram"],["16","Tripura"],["17","Meghalaya"],["18","Assam"],["19","West Bengal"],
  ["20","Jharkhand"],["21","Odisha"],["22","Chhattisgarh"],["23","Madhya Pradesh"],["24","Gujarat"],
  ["26","Dadra and Nagar Haveli and Daman and Diu"],["27","Maharashtra"],["29","Karnataka"],
  ["30","Goa"],["31","Lakshadweep"],["32","Kerala"],["33","Tamil Nadu"],["34","Puducherry"],
  ["35","Andaman and Nicobar Islands"],["36","Telangana"],["37","Andhra Pradesh"],["38","Ladakh"]
];
export const INDIA_STATES_AND_UTS = INDIA_GST_STATES.map(([,label])=>label);

export const GST_SLABS = ["0-40 Lakh", "40 Lakh-1.5 Cr", "1.5-5 Cr", "5-25 Cr", "25-100 Cr", "100-500 Cr", "500 Cr and above"];
export const BUYER_GROUP_TAGS = ["Important Buyer", "Medium Priority", "Standard Buyer", "Low Priority", "Strategic Account", "Key Account"];

let setupPromise;
export function ensureCoreBuyerDropdowns() {
  if (setupPromise) return setupPromise;
  setupPromise = (async () => {
  // Older databases restricted this column to the original buyer master types.
  // Dropdown groups are now administrator-configurable, so NOT NULL is the only required type constraint.
  await query("ALTER TABLE buyer_master_values DROP CONSTRAINT IF EXISTS buyer_master_values_master_type_check");
  await query(`INSERT INTO buyer_master_values(master_type,label,code)
    SELECT 'state',entry->>1,entry->>0 FROM jsonb_array_elements($1::jsonb) entry
    ON CONFLICT(master_type,label) DO UPDATE SET code=EXCLUDED.code`, [JSON.stringify(INDIA_GST_STATES)]);
  await query(`INSERT INTO buyer_master_values(master_type,label,code)
    SELECT 'gst_slab',value,regexp_replace(value,'[^0-9]+','_','g') FROM unnest($1::text[]) value
    ON CONFLICT(master_type,label) DO NOTHING`, [GST_SLABS]);
  await query(`INSERT INTO buyer_master_values(master_type,label,code)
    SELECT 'group_tag',value,upper(regexp_replace(value,'[^a-zA-Z0-9]+','_','g')) FROM unnest($1::text[]) value
    ON CONFLICT(master_type,label) DO NOTHING`, [BUYER_GROUP_TAGS]);
  })().catch(error => { setupPromise = null; throw error; });
  return setupPromise;
}
