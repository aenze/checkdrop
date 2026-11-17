# Running a Checkdrop installation

Installation steps are in [INSTALL.md](../INSTALL.md). This page is for running it afterwards.

## What runs

| Service | Role |
| --- | --- |
| `postgres` | The installation's only database, on a private Docker network |
| `migrate` | Applies database migrations before every start of the server, then exits |
| `app` | API, checkout script, administration API, sign-in |
| `jobs` | Address import after installation, then daily: RÚIAN check, 90-day cleanup, expired sessions |
| `web` | Caddy: HTTPS, the administration, and the public API under `/v1/` |

Everything lives in the installation directory (default `/opt/checkdrop`): `checkdrop`,
`compose.yaml`, `.env` (settings and keys, mode 600), `state/` (update status) and `backups/`.
Data is in the Docker volumes `checkdrop_postgres` and `checkdrop_caddy-data`.

## Settings in `.env`

The installer writes them. After editing `.env` by hand, run `./checkdrop apply`.

| Setting | Meaning |
| --- | --- |
| `CHECKDROP_PUBLIC_URL` | Public address, e.g. `https://checks.example.com`; used in the script tag shops embed |
| `CHECKDROP_SITE_ADDRESS` | What Caddy serves: the domain (automatic HTTPS), `http://localhost`, or `:8080` behind another proxy |
| `CHECKDROP_HTTP_BIND`, `CHECKDROP_HTTPS_BIND` | Host ports, `80` and `443` by default |
| `CHECKDROP_AUTO_UPDATE` | `true` (default) or `false` |
| `CHECKDROP_VERSION` | Installed release; changed by `./checkdrop update` |
| `CHECKDROP_JOBS_TIME` | Daily jobs time in UTC, `03:35` by default |
| `CHECKDROP_ADMIN_AUTH` | `password` (default). `external` only if an access proxy authenticates every request |
| Secrets | `CHECKDROP_POSTGRES_PASSWORD`, `…_OPERATOR_TOKEN`, `…_EMBED_SIGNING_SECRET`, `…_OBSERVATION_ENCRYPTION_KEY`, `…_PILOT_API_KEY`, `…_ADMIN_SETUP_CODE` — generated, never shared |

Losing `CHECKDROP_OBSERVATION_ENCRYPTION_KEY` makes stored monitor values unreadable. Every backup
keeps a copy of `.env` next to the database dump.

## Updates

`checkdrop update --auto` runs daily from a systemd timer (or cron). It reads `release.json` of the
newest release, and when a newer version exists it:

1. backs up the database and `.env` into `backups/` (the newest ten are kept);
2. downloads the new `compose.yaml` and `checkdrop` and checks them against the release checksums;
3. pulls the new images and starts them; migrations run first;
4. waits until the server reports the new version as healthy;
5. otherwise returns to the previous version and records why.

The administration shows the running version, a newer one if available, and the last result.
Manual: `./checkdrop update --check`, `./checkdrop update`. Turn automatic updates off with
`CHECKDROP_AUTO_UPDATE=false` in `.env`.

Migrations only add tables and columns, so a rolled-back server keeps working on the newer schema.

## Backups and moving

```bash
./checkdrop backup                          # backups/checkdrop-<version>-<time>.dump and env-<time>
./checkdrop restore backups/checkdrop-….dump
```

Address data is left out of backups; the jobs service downloads it again after a restore. To move to
a new server: install there, copy the matching `env-…` file to `.env`, run `./checkdrop install` and
then `./checkdrop restore`.

## Behind another proxy

Set `CHECKDROP_SITE_ADDRESS=:8080`, `CHECKDROP_HTTP_BIND=127.0.0.1:8080` and
`CHECKDROP_PUBLIC_URL=https://<public name>`, then let your proxy terminate TLS and forward to
`127.0.0.1:8080` with the original `Host` header.

## Resources

Measured on a local test installation (November 2026):

| | |
| --- | --- |
| First address import | 3,023,704 addresses in about 5 minutes on 8 cores; expect 10–15 minutes on 2 cores |
| Database with addresses | 2.6 GB, Docker volume 3.8 GB |
| Memory at rest | server ~50 MB, web ~30 MB, PostgreSQL ~100–600 MB; jobs ~400 MB during the import |

## Problems

```bash
./checkdrop status            # what is wrong, in one screen
./checkdrop logs app          # or jobs, web, postgres
```

- **Certificate not issued:** the domain must point to this server and port 80 must be reachable.
- **Addresses stay “failed”:** the server cannot reach `vdp.cuzk.gov.cz`; the jobs service retries
  nightly, or restart it with `docker compose restart jobs` in the installation directory.
- **Forgotten password:** `./checkdrop reset-password admin@example.com` (new password on stdin).

## Stopping and removing

`docker compose stop` in the installation directory stops everything and keeps the data.
Removing data (`docker compose down -v`) cannot be undone; take a backup first.
