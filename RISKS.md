# Risks

| Risk | Evidence needed | Mitigation |
| --- | --- | --- |
| Address suggestions create harmful false corrections | Labeled Czech fixture set and shadow outcomes | Assist-only, deterministic ranking, expose evidence |
| `pg_trgm` is too slow for full RÚIAN | Full-size benchmark with p50/p95/p99 and query plans | Normalize columns, narrow candidates, tune indexes before adding search tech |
| One server is a single failure domain | Backup/restore and outage drill | Off-host encrypted backups, documented restore, Cloudflare health controls |
| External sources are stale or down | Freshness and timeout metrics | Bounded cache, explicit `unknown`, fail open |
| Raw PII enters logs or fixtures | Automated scans and fixture review | Allow-list logging, synthetic fixtures, short retention |
| Too much product work precedes validation proof | Milestone gate evidence | No signup/dashboard/Stripe work before shadow results |
| Self-hosted causes product drift | Conformance tests once packaging starts | Same image, contract, migrations, and core packages |
