# Checkout measurement

The embed script reports how people move through a mapped form to
`POST /v1/checkout/events?site=…&form=…&session=…`. The endpoint uses the same origin check and active
site as validation, has its own rate limit and never blocks the form: a failed event is dropped.

## What it records

| Event               | Meaning                                                                        |
| ------------------- | ------------------------------------------------------------------------------ |
| `started`           | First edit of a mapped field (not a page visit)                                |
| `activity`          | Still filling in; sampled at most once per 30 seconds                          |
| `submit_attempt`    | The person tried to submit                                                     |
| `blocked`           | Submit was stopped; carries a fixed reason code and the field, never a message |
| `submit_dispatched` | The browser submit event was not cancelled                                     |
| `page_left`         | The page was left (also a normal step to payment or a reload)                  |
| `purchase_reported` | The page reported a purchase in its `dataLayer` (see below)                    |

Blocking reasons distinguish Checkdrop's own checks (`checkdrop_name`, `checkdrop_phone`,
`checkdrop_foreign_address`), the browser's required/format validation, the shop's own validation
and a generically cancelled submit (`shop_cancelled`, which may also be an AJAX submit and is not an
error by itself).

The body accepts only `event_id` (UUID v4), `event`, `source`, `reason`, `field` and `context`, plus
`order_ref` and `purchase_channel` for purchases. No contact values or URLs are accepted. The session
reference is stored as an HMAC, a repeated event ID is stored once, and records are deleted after
90 days. Neither `submit_attempt` nor `submit_dispatched` proves that an order was created or paid.

## Reported purchases

The script passively reads objects in the page's `dataLayer` with the event `purchase` (or the
wholesale variant `purchase_velkoobchod`) and a non-empty `ecommerce.transaction_id`. It only counts
them after an interaction with the mapped form in the same browser session within 24 hours. The
order number (1–80 letters, digits, `-` or `_`) is stored only as an HMAC, so the same order is
counted once; products, values and the rest of the `dataLayer` are not copied.

The monitor shows these as purchases reported by the page in the browser, not as confirmed payments.

## Test traffic

Open the form with `?checkdrop_test=1` to mark your own tests. The monitor hides marked tests by
default. Unmarked tests cannot be told apart from real customers.
