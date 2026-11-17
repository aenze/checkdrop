# Data sources

Checkdrop does not ship any national data set. Each installation downloads or queries the sources
below directly, and must keep their attribution where it shows their data.

| Source | Used for | How | Terms |
| --- | --- | --- | --- |
| RÚIAN, special address data set `ST_UADS`, ČÚZK | Czech address points, streets, municipalities, PSČ | Monthly download from `vdp.cuzk.gov.cz` into the installation's PostgreSQL | © ČÚZK, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); attribution “ČÚZK, CC BY 4.0” is shown in the administration |
| ARES, Ministry of Finance of the Czech Republic | Company name and address by IČO, company search | Live request with a short timeout and a bounded cache; failures return “unknown” | Public data under the [ARES terms of use](https://ares.gov.cz/stranky/podminky-pouziti) |
| DNS (MX/A records) | Whether an e-mail domain can receive mail | Live lookup with a deadline and cache | — |
| libphonenumber metadata (bundled in `libphonenumber-js`) | Phone number formats | Package dependency | MIT |

Fixtures in `fixtures/` contain only invented or public example values. `fixtures/ruian` is a small
sample in the RÚIAN exchange format for tests.

If you add a country, record its sources here with their licence and attribution before using them.
