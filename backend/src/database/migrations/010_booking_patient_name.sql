ALTER TABLE bookings ADD COLUMN IF NOT EXISTS patient_name VARCHAR(255);
UPDATE bookings b SET patient_name = c.name FROM customers c WHERE c.id = b.customer_id AND b.patient_name IS NULL;
