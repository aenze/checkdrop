ALTER TABLE app.integration_fields
  ADD COLUMN require_valid_phone boolean NOT NULL DEFAULT false;

ALTER TABLE app.integration_fields
  ADD CONSTRAINT integration_fields_required_phone_check CHECK (
    NOT require_valid_phone OR (
      canonical_field = 'phone' AND validation_mode <> 'off'
    )
  );

ALTER TABLE app.checkout_events DROP CONSTRAINT checkout_events_reason_check;
ALTER TABLE app.checkout_events ADD CHECK (
  reason IN (
    'none','checkdrop_name','checkdrop_foreign_address','checkdrop_phone','native_required',
    'native_format','shop_validation','shop_cancelled'
  )
);
