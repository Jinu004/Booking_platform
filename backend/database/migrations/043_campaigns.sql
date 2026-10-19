-- Marketing campaigns (poster sends). Two new tables, additive only.
-- campaigns: one send of a poster to a clinic's opted-in patients (draft -> running -> completed, or paused/cancelled).
-- campaign_recipients: one row per patient in a campaign. consent_value is the patient's marketing_consent when the row was created (proof of consent).
-- The phone number is not stored here; it is always read from customers when sending.
BEGIN;

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  poster_request_id UUID REFERENCES poster_requests(id) ON DELETE SET NULL,
  template_name TEXT NOT NULL DEFAULT 'clinic_poster',
  caption TEXT,
  meta_media_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'paused', 'completed', 'cancelled')),
  paused_reason TEXT,
  audience_count INTEGER,
  daily_cap INTEGER,
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_status ON campaigns (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_created ON campaigns (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  skip_reason TEXT,
  consent_value TEXT,
  error_code TEXT,
  error_message TEXT,
  wa_message_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_status ON campaign_recipients (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_wa_message_id ON campaign_recipients (wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_tenant_customer_sent ON campaign_recipients (tenant_id, customer_id, sent_at);

COMMIT;
