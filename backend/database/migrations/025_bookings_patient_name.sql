-- Denormalized patient name on bookings (family booking support; falls back to customer name)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS patient_name VARCHAR(255);
