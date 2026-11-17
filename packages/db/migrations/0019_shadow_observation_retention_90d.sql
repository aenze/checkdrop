-- The customer-approved operator-review window is 90 days. Full values remain AES-256-GCM
-- ciphertext and are available only through the Cloudflare Access-protected operator monitor.
ALTER TABLE app.shadow_observations
  DROP CONSTRAINT IF EXISTS shadow_observations_check1;

ALTER TABLE app.shadow_observations
  ADD CONSTRAINT shadow_observations_retention_90d
  CHECK (expires_at <= created_at + interval '90 days');

-- Preserve the currently retained observation window when this policy is first applied. Rows that
-- already expired are never restored.
UPDATE app.shadow_observations
SET expires_at = created_at + interval '90 days'
WHERE expires_at > now()
  AND expires_at <= created_at + interval '25 hours';
