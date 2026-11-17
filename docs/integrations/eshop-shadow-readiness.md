# E-shop shadow connection readiness

This is the handoff checklist for connecting one real e-shop without changing customer data or
checkout behavior.

## Ready in Checkdrop

- server-authenticated e-mail, Czech phone, required delivery-name, RÚIAN address/country
  consistency, and ARES company-ID validation;
- separately feature-flagged Czech RÚIAN address autocomplete that applies structured fields only
  after an explicit customer selection;
- separately feature-flagged full-name guidance that warns about a missing surname without blocking
  checkout and offers only safe formatting corrections for explicit confirmation;
- server-only same-origin proxy with an allow-list, 8 KiB body cap, 3 s deadline, local rate limit,
  redacted errors, and no browser key;
- explicit `recordPreviews` switch controlled by the e-shop server;
- project-isolated 90-day encrypted observation storage and automatic expiry;
- protected `/monitor` feed with input/proposal preview, reason/source, result, and server latency;
- fail-open behavior when DNS, Checkdrop, or optional preview storage is unavailable;
- no submit prevention, field mutation, visible suggestion, or write-back in shadow mode.
- Access-protected URL-first onboarding with automatic field detection, explicit ignore/mode/trigger
  choices, combined full-name validation, one-time test-key creation, and selector-drift reporting;
- key-linked `GET /v1/integration/config` so the saved mapping is consumable by the e-shop runtime.

## Inputs needed from the e-shop

These are configuration inputs, not Checkdrop feature work:

1. platform/framework and the repository path or integration documentation;
2. staging checkout/contact form URL; exact selectors are needed only for authenticated or dynamic
   fields the safe HTML scanner cannot see;
3. trusted server route where the Checkdrop proxy will be mounted;
4. secret-store location for one project-specific pilot key;
5. technical owner, approved staging users, and rollback owner;
6. agreed client identifier such as `shop-checkout/1.0` and per-source request limit;
7. confirmation that 90-day encrypted full values are approved for the test window.

## Acceptance before real traffic

| Gate | Required evidence |
| --- | --- |
| Form invariance | Same submit result with observer enabled and disabled |
| No key in browser | Built assets and network request contain no pilot key |
| Masking | Synthetic e-mail, phone, names, full address numbers, and full IČO do not occur in DB or retained logs |
| Country consistency | Slovak address declared as `CZ` returns `invalid / block / address.country_mismatch` |
| Address autocomplete | Czech suggestions appear after three characters; failure preserves manual input |
| Monitor | Synthetic request appears once with full protected input/proposal and measured latency |
| Fail-open | Forced API/storage failure does not block or change checkout |
| Isolation | Another project cannot list the observation |
| Retention | Observation is excluded after expiry and cleanup deletes it |
| Rollback | Observer/proxy can be disabled independently without Checkdrop deployment |

## Promotion boundary

Shadow success does not enable automatic correction. The separately approved autocomplete may fill
street, city, and postal code only after the customer selects a suggestion. Full-name guidance may
explain that both name parts are needed, but cannot guess or silently add a surname. Any other later production change needs an explicit
field-by-field policy: which corrections may be applied automatically, which are only shown, which
must fail open, and how the original value and customer outcome are audited. That release remains
off until the shadow evidence is reviewed and approved.
