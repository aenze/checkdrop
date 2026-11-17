ALTER TABLE app.shadow_observations
  ADD COLUMN IF NOT EXISTS input_value_ciphertext text,
  ADD COLUMN IF NOT EXISTS proposed_value_ciphertext text;

ALTER TABLE app.shadow_observations
  DROP CONSTRAINT IF EXISTS shadow_observations_input_ciphertext_length,
  DROP CONSTRAINT IF EXISTS shadow_observations_proposed_ciphertext_length;

ALTER TABLE app.shadow_observations
  ADD CONSTRAINT shadow_observations_input_ciphertext_length CHECK (
    input_value_ciphertext IS NULL
    OR char_length(input_value_ciphertext) BETWEEN 20 AND 12000
  ),
  ADD CONSTRAINT shadow_observations_proposed_ciphertext_length CHECK (
    proposed_value_ciphertext IS NULL
    OR char_length(proposed_value_ciphertext) BETWEEN 20 AND 12000
  );
