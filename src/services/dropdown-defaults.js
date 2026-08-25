import { query } from "../db.js";

export const INDIA_STATES_AND_UTS = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh",
  "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep",
  "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry",
  "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"
];

export const GST_SLABS = ["Nil (0%)", "0.25%", "3%", "5%", "12%", "18%", "28%"];

let setupPromise;
export function ensureCoreBuyerDropdowns() {
  if (setupPromise) return setupPromise;
  setupPromise = (async () => {
  // Older databases restricted this column to the original buyer master types.
  // Dropdown groups are now administrator-configurable, so NOT NULL is the only required type constraint.
  await query("ALTER TABLE buyer_master_values DROP CONSTRAINT IF EXISTS buyer_master_values_master_type_check");
  await query(`INSERT INTO buyer_master_values(master_type,label,code)
    SELECT 'state',value,upper(regexp_replace(value,'[^a-zA-Z0-9]+','_','g')) FROM unnest($1::text[]) value
    ON CONFLICT(master_type,label) DO NOTHING`, [INDIA_STATES_AND_UTS]);
  await query(`INSERT INTO buyer_master_values(master_type,label,code)
    SELECT 'gst_slab',value,regexp_replace(value,'[^0-9]+','_','g') FROM unnest($1::text[]) value
    ON CONFLICT(master_type,label) DO NOTHING`, [GST_SLABS]);
  })().catch(error => { setupPromise = null; throw error; });
  return setupPromise;
}
