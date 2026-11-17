ALTER TABLE app.checkout_events DROP CONSTRAINT checkout_events_event_check;
ALTER TABLE app.checkout_events ADD CHECK (event IN ('started','activity','submit_attempt','blocked','submit_dispatched','page_left','purchase_reported'));
ALTER TABLE app.checkout_events ADD COLUMN order_ref text;
ALTER TABLE app.checkout_events ADD COLUMN purchase_channel text CHECK (purchase_channel IN ('b2c','b2b'));
CREATE UNIQUE INDEX checkout_purchase_unique ON app.checkout_events(integration_id,order_ref) WHERE order_ref IS NOT NULL;
