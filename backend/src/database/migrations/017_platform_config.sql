CREATE TABLE IF NOT EXISTS platform_config (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  value DECIMAL(10,4) NOT NULL,
  label VARCHAR(200) NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO platform_config (key, value, label) VALUES
('meta_utility_rate', 0.1300, 'Meta Utility Message Rate (₹/msg)'),
('meta_marketing_rate', 0.8700, 'Meta Marketing Message Rate (₹/msg)'),
('gemini_input_rate', 0.3000, 'Gemini Input Rate ($/1M tokens)'),
('gemini_output_rate', 2.5000, 'Gemini Output Rate ($/1M tokens)'),
('usd_inr_rate', 83.5000, 'USD to INR Rate')
ON CONFLICT (key) DO NOTHING;
