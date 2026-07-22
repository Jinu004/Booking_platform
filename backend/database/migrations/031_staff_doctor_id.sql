-- Migration 031: Add doctor_id to staff table for doctor role linking
ALTER TABLE staff ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES clinic_doctors(id) ON DELETE SET NULL;
