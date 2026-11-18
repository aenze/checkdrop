# Risks

| Risk                                                 | Evidence needed                                      | Mitigation                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Address suggestions create harmful false corrections | Labeled Czech fixture set and observed outcomes      | Suggestions only after confirmation, deterministic ranking, expose evidence             |
| `pg_trgm` is too slow for full RÚIAN                 | Full-size benchmark with p50/p95/p99 and query plans | Normalize columns, narrow candidates, tune indexes before adding search tech            |
| One server is a single failure domain                | Backup/restore and outage drill                      | Backup before every update and on demand, documented restore, rollback on failed update |
| External sources are stale or down                   | Freshness and timeout metrics                        | Bounded cache, explicit `unknown`, fail open                                            |
| Raw PII enters logs or fixtures                      | Automated scans and fixture review                   | Allow-list logging, synthetic fixtures, short retention                                 |
| Self-hosted causes product drift                     | Conformance tests                                    | One release image for every installation; CI checks both compose variants               |
