# Hosted shadow integration

Checkdrop measures configured checkout fields without changing the form, blocking submit, or
exposing a secret API key in the browser.

## Default installation

Create a website in the protected admin, add each page that contains a form, and map its fields.
Then add the generated tag once, before the final `</body>` in the website's shared footer:

```html
<script async src="https://api.checkdrop.dev/v1/embed.js" data-checkdrop-site="PUBLIC_SITE_ID"></script>
```

That is the supported pilot integration. It needs no npm package, GitHub access, e-shop proxy, or
private browser key. If the shop uses Content Security Policy, allow the origin of the generated tag in both
`script-src` and `connect-src` (`https://api.checkdrop.dev` for the hosted service, your own
domain for a self-hosted installation).

## Multiple forms and pages

One website has one public site identifier and one script tag. It can have any number of independent
form profiles, for example checkout, registration, contact, wholesale inquiry, or a multi-step
account flow. Each profile has its own DOM `root_selector`, field mapping, validation rules, version
history, and state. More profiles may match the same path when their roots are different.

- **Exact path** matches only one normalized pathname, such as `/checkout`.
- **Path prefix** also matches nested pages, such as `/account/register/step-2`.
- An exact match wins over a prefix; otherwise the longest matching prefix wins.
- Profiles must use the same origin. A different domain or subdomain is a separate website.
- Query parameters and URL fragments are neither used for routing nor sent to Checkdrop.
- A page without an active profile is ignored. Its forms keep working normally.

The script detects path changes in single-page applications and loads the appropriate profile. New
form pages are added in the admin; the website's shared script tag does not change.

## Runtime behavior

The hosted script:

- sends the current pathname and loads all matching origin-bound, versioned form mappings;
- follows each configured input, blur, or submit trigger;
- evaluates private/company, expanded-details and alternate-shipping conditions and Czech country
  rules;
- sends only the values required by the selected validation operation;
- in shadow mode never assigns a value or renders a correction; enabled assist rules can render a
  non-blocking suggestion or apply only the explicitly configured safe normalization;
- aborts quickly and fails open when Checkdrop is unavailable.

The public site identifier cannot access imports, operator routes, or arbitrary API paths. Validation
routes have bounded JSON bodies, origin checks, rate ceilings, and provider deadlines.

## Protected monitor

The protected application requests
`GET /checkdrop/v1/operator/observations?page=1&page_size=100` through its server-held operator
credential. It shows time, website, form profile, field, full input and proposal, result, evidence,
and server latency. Full field values are encrypted at rest and available only through the
protected operator route. Request bodies and plaintext idempotency keys are never stored.

Observation retention is project-isolated, fail-open, and limited to 90 days. Autocomplete is an
explicit user interaction and does not create a shadow row.

## Rollout

1. Configure all form pages that should be measured and keep the website in shadow mode.
2. Install the generated script and verify the checkout still succeeds with Checkdrop blocked.
3. Confirm one real request in the protected monitor; keep synthetic QA separately labeled.
4. Measure proposal volume, issue mix, latency, provider failure, and labeled outcomes.
5. Implement assist/write-back only as a separate approved release with rollback and acceptance
   tests. Shadow configuration must never silently mutate data.

Billing and shipping are independent contexts. RÚIAN writes only within the selected address group;
ARES writes only company and billing fields. Passwords, newsletter choices, and consent checkboxes
are ignored.

Custom server-to-server clients may call the documented validation API directly with a server-held
key. A reusable npm SDK is intentionally not maintained until a concrete client requirement
justifies that surface.
