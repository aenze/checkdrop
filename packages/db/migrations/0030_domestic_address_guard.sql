ALTER TABLE app.integration_fields
  ADD COLUMN require_domestic_address boolean NOT NULL DEFAULT false;

ALTER TABLE app.integration_fields
  ADD CONSTRAINT integration_fields_domestic_address_check CHECK (
    NOT require_domestic_address OR (
      canonical_field = 'postal_code' AND validation_mode <> 'off'
    )
  );

ALTER TABLE app.checkout_events DROP CONSTRAINT checkout_events_reason_check;
ALTER TABLE app.checkout_events ADD CHECK (
  reason IN (
    'none','checkdrop_name','checkdrop_foreign_address','native_required','native_format',
    'shop_validation','shop_cancelled'
  )
);
