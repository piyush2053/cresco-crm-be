BEGIN;

-- Older CRM databases restrict master_type to the original fixed list.
-- The Dropdown Value Manager now supports administrator-defined groups.
ALTER TABLE buyer_master_values
  DROP CONSTRAINT IF EXISTS buyer_master_values_master_type_check;

INSERT INTO buyer_master_values(master_type,label,code) VALUES
('gst_slab','Nil (0%)','GST_0'),('gst_slab','0.25%','GST_0_25'),('gst_slab','3%','GST_3'),
('gst_slab','5%','GST_5'),('gst_slab','12%','GST_12'),('gst_slab','18%','GST_18'),('gst_slab','28%','GST_28')
ON CONFLICT(master_type,label) DO NOTHING;

INSERT INTO buyer_master_values(master_type,label,code) VALUES
('state','Andaman and Nicobar Islands','ANDAMAN_AND_NICOBAR_ISLANDS'),('state','Andhra Pradesh','ANDHRA_PRADESH'),
('state','Arunachal Pradesh','ARUNACHAL_PRADESH'),('state','Assam','ASSAM'),('state','Bihar','BIHAR'),
('state','Chandigarh','CHANDIGARH'),('state','Chhattisgarh','CHHATTISGARH'),
('state','Dadra and Nagar Haveli and Daman and Diu','DADRA_NAGAR_HAVELI_DAMAN_DIU'),('state','Delhi','DELHI'),
('state','Goa','GOA'),('state','Gujarat','GUJARAT'),('state','Haryana','HARYANA'),
('state','Himachal Pradesh','HIMACHAL_PRADESH'),('state','Jammu and Kashmir','JAMMU_AND_KASHMIR'),
('state','Jharkhand','JHARKHAND'),('state','Karnataka','KARNATAKA'),('state','Kerala','KERALA'),
('state','Ladakh','LADAKH'),('state','Lakshadweep','LAKSHADWEEP'),('state','Madhya Pradesh','MADHYA_PRADESH'),
('state','Maharashtra','MAHARASHTRA'),('state','Manipur','MANIPUR'),('state','Meghalaya','MEGHALAYA'),
('state','Mizoram','MIZORAM'),('state','Nagaland','NAGALAND'),('state','Odisha','ODISHA'),
('state','Puducherry','PUDUCHERRY'),('state','Punjab','PUNJAB'),('state','Rajasthan','RAJASTHAN'),
('state','Sikkim','SIKKIM'),('state','Tamil Nadu','TAMIL_NADU'),('state','Telangana','TELANGANA'),
('state','Tripura','TRIPURA'),('state','Uttar Pradesh','UTTAR_PRADESH'),('state','Uttarakhand','UTTARAKHAND'),
('state','West Bengal','WEST_BENGAL')
ON CONFLICT(master_type,label) DO NOTHING;

COMMIT;
