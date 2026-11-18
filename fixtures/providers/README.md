# Provider contract fixtures

These files are deterministic response-shape fixtures for adapter tests. They are not cached live
answers.

- ares/company-00006947.json is a minimal projection of the public ARES response for the Czech
  Ministry of Finance, captured on 2026-08-15.
  CI replays these files through injected fetch and must never call ARES. A live smoke check is an
  explicit, single-request operator action.
