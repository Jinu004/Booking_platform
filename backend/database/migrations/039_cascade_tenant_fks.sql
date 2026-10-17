-- Deleting a tenant must also remove its rows in these four tables (the other tenant tables already cascade).
-- Same constraint names and column as before; only ON DELETE CASCADE is added.
BEGIN;

ALTER TABLE clinic_profiles DROP CONSTRAINT clinic_profiles_tenant_id_fkey;
ALTER TABLE clinic_profiles ADD CONSTRAINT clinic_profiles_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE clinic_services DROP CONSTRAINT clinic_services_tenant_id_fkey;
ALTER TABLE clinic_services ADD CONSTRAINT clinic_services_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE doctor_leaves DROP CONSTRAINT doctor_leaves_tenant_id_fkey;
ALTER TABLE doctor_leaves ADD CONSTRAINT doctor_leaves_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE doctor_schedules DROP CONSTRAINT doctor_schedules_tenant_id_fkey;
ALTER TABLE doctor_schedules ADD CONSTRAINT doctor_schedules_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

COMMIT;
