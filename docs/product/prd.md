# Product requirements

## Problem

Teams collect customer data through forms and APIs but cannot reliably distinguish harmless format
differences from invalid or risky records. Existing checks often overpromise certainty, hide their
sources, or force hard blocking that harms conversion.

## Product

Checkdrop returns normalized values, a five-state assessment, stable issue codes, evidence, and a
recommended action under the project's chosen policy. Czech sources and language are first-class,
while the API model supports additional country packs.

## First pilot journey

An integration sends data in shadow mode. Checkdrop produces an explainable result without changing
the form or blocking the person. The protected operator monitor retains encrypted full field values
for at most 90 days so the customer can compare inputs and suggestions before enabling assist mode.

## Non-goals for the first pilot

- Deliverability guarantees, mailbox ownership proof, or credit scoring.
- Automated blocking by default.
- Global address coverage.
- LLM-based synchronous validation.
- Public signup or billing before validation evidence and tenant-isolation tests.

## Acceptance principles

- Every result is explainable and tied to evidence.
- `unknown` is a valid state and fails open by default.
- Raw PII is not logged or used as an analytics identifier; short-lived monitor values are
  encrypted and operator-only.
- OpenAPI changes and behavior tests ship together.
- Local, CI, staging, production, and pilot evidence are reported separately.
