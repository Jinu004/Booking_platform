CREATE TABLE IF NOT EXISTS catalogue_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id VARCHAR(50) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT DEFAULT '',
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  in_stock BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, product_id)
);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_phone VARCHAR(20) NOT NULL,
  customer_name VARCHAR(100) DEFAULT '',
  product_id VARCHAR(50) DEFAULT '',
  product_name VARCHAR(200) DEFAULT '',
  quantity INTEGER DEFAULT 1,
  delivery_address TEXT DEFAULT '',
  alt_phone VARCHAR(20) DEFAULT '',
  notes TEXT DEFAULT '',
  status VARCHAR(20) DEFAULT 'new',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalogue_tenant ON catalogue_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_tenant ON leads(tenant_id);
