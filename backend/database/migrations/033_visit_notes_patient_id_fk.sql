-- Add missing FK constraint on visit_notes.patient_id
-- Migration 022 skipped this because the column already existed from 014b
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'visit_notes_patient_id_fkey'
  ) THEN
    ALTER TABLE visit_notes
    ADD CONSTRAINT visit_notes_patient_id_fkey
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL;
  END IF;
END $$;
