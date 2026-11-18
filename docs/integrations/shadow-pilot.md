# Embedding Checkdrop in a website

Checkdrop checks configured form fields through one script tag, without a secret API key in the
browser. New fields only observe: they never change the form or block a submit.

## Install the script

Add a website in the administration, add each page that contains a form, and map its fields. Then
add the generated tag once, before the final `</body>` in the website's shared footer:

```html
<script async src="https://<your-installation>/v1/embed.js" data-checkdrop-site="PUBLIC_SITE_ID"></script>
```

If you use the hosted service instead of your own installation, the address is
`https://api.checkdrop.dev/v1/embed.js`. No npm package, proxy or private browser key is needed. If
the website uses a Content Security Policy, allow the installation's origin in both `script-src`
and `connect-src`.

## Multiple forms and pages

One website has one public site key and one script tag. It can have any number of form profiles,
for example checkout, registration, contact or a multi-step account flow. Each profile has its own
`root_selector`, field mapping, rules, version history and state; several profiles may match the
same path when their roots differ.

- **Exact path** matches one normalized pathname, such as `/checkout`.
- **Path prefix** also matches nested pages, such as `/account/register/step-2`.
- An exact match wins over a prefix; otherwise the longest matching prefix wins.
- Profiles use the same origin. A different domain or subdomain is a separate website.
- Query parameters and fragments are neither used for routing nor sent to Checkdrop.
- A page without an active profile is ignored; its forms keep working normally.

The script follows path changes in single-page applications. New form pages are added in the
administration; the script tag does not change.

## What the script does

- sends the current pathname and loads the matching origin-bound, versioned form mappings;
- follows each configured input, blur or submit trigger, including private/company, expanded
  details and alternate-shipping conditions;
- sends only the values the selected check needs;
- in observe mode never changes a value or shows anything; with suggestions on, it shows a
  suggestion that the person confirms, and a field can optionally stop a submit whose details make
  delivery impossible;
- gives up quickly and lets the form submit when Checkdrop is unavailable.

The public site key cannot reach administration routes or arbitrary API paths. Billing and
shipping are separate groups: RÚIAN fills only the chosen address group, ARES only company and
billing fields. Passwords, newsletter choices and consent checkboxes are ignored.

## Monitor

The monitor in the administration shows time, website, form profile, field, the typed value and the
suggestion, result, evidence and server latency. Full values are encrypted at rest and deleted after
90 days. Request bodies are never stored. Address autocomplete is an explicit choice and does not
create a monitor row.

## Rollout

1. Map every form page you want to check and keep its fields on observe.
2. Install the script and check that the form still submits when Checkdrop is blocked.
3. Confirm one real request in the monitor; open the form with `?checkdrop_test=1` for your own
   tests ([checkout measurement](../checkout-measurement.md)).
4. After a few days, turn on suggestions field by field where the monitor shows they help.

Server-to-server clients can call the [HTTP API](public-api.md) directly with a key kept on the
server.
