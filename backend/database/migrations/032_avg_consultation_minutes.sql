-- Migration 032: Add avg_consultation_minutes to clinic_doctors for dynamic token capacity
ALTER TABLE clinic_doctors ADD COLUMN IF NOT EXISTS avg_consultation_minutes INTEGER DEFAULT 10;
