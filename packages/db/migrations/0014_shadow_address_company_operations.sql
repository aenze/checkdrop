ALTER TABLE app.shadow_observations
  DROP CONSTRAINT IF EXISTS shadow_observations_operation_check;

ALTER TABLE app.shadow_observations
  ADD CONSTRAINT shadow_observations_operation_check
  CHECK (
    operation IN (
      'email.validate',
      'phone.validate',
      'address.validate',
      'company_id.validate'
    )
  );
