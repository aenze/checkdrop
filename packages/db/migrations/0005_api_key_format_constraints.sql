ALTER TABLE app.api_keys
  ADD CONSTRAINT api_keys_prefix_format
  CHECK (key_prefix ~ '^cdp_[a-f0-9]{12}$');

ALTER TABLE app.api_keys
  ADD CONSTRAINT api_keys_verifier_format
  CHECK (verifier ~ '^sha256:[a-f0-9]{64}$');
