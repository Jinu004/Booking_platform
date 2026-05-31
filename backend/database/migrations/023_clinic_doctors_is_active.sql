ALTER TABLE clinic_doctors ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
UPDATE clinic_doctors SET is_active = true WHERE is_active IS NULL;
