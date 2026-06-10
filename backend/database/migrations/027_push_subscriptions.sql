-- 027_push_subscriptions.sql
-- Creates the push_subscriptions table required by push.service.js.
-- The service stores one Web Push subscription per staff member and fans
-- out notifications to all subscriptions for a given tenant.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id     UUID NOT NULL REFERENCES staff(id)   ON DELETE CASCADE,
  subscription TEXT NOT NULL,
  created_at   TIMESTAMP DEFAULT NOW(),

  -- ON CONFLICT (staff_id) in push.service.js requires this
  CONSTRAINT push_subscriptions_staff_id_key UNIQUE (staff_id)
);

-- Fast lookup for sendPushToTenant: WHERE tenant_id = 
CREATE INDEX IF NOT EXISTS push_subscriptions_tenant_id_idx
  ON push_subscriptions (tenant_id);

GRANT ALL PRIVILEGES ON TABLE push_subscriptions TO appuser;
GRANT ALL PRIVILEGES ON TABLE push_subscriptions TO appuser;
