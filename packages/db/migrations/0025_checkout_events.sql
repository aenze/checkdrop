CREATE TABLE app.checkout_events (
  project_ref text NOT NULL,
  integration_id text NOT NULL,
  form_id text NOT NULL,
  session_ref text NOT NULL,
  event_id uuid NOT NULL,
  event text NOT NULL CHECK (event IN ('started','activity','submit_attempt','blocked','submit_dispatched','page_left')),
  source text NOT NULL CHECK (source IN ('customer','test')),
  reason text NOT NULL CHECK (reason IN ('none','checkdrop_name','native_required','native_format','shop_validation','shop_cancelled')),
  field text NOT NULL,
  context text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id,event_id)
);
CREATE INDEX checkout_events_session ON app.checkout_events(project_ref,session_ref,created_at);
CREATE INDEX checkout_events_time ON app.checkout_events(created_at);
