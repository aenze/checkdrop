# Installing Checkdrop — guide for AI agents and people

This page is written so an AI agent can install Checkdrop without asking questions. A person can
follow it too. [Česky](INSTALL.cs.md)

**Goal:** a running Checkdrop installation at `https://<domain>`, healthy, reachable from the
internet, with a one-time setup code handed to the person who will administer it.

## 1. What you need from the person

- **SSH access** to a Linux server (Debian, Ubuntu or similar, 64-bit) as root or a sudo user.
- **A domain name** whose DNS A (and AAAA, if the server has IPv6) record points to that server,
  for example `checks.example.com`. Ask for it if you were not given one.

Do not ask for anything else. The installer generates every password and key itself.

## 2. Check the server

Run and read each result:

```bash
uname -m                      # x86_64 or aarch64
nproc; free -g; df -h /       # at least 2 CPUs, 4 GB RAM, 20 GB free disk
docker version --format '{{.Server.Version}}'
docker compose version
getent hosts checks.example.com   # must print this server's public IP
```

- If Docker is missing, install Docker Engine with the official instructions for the distribution:
  <https://docs.docker.com/engine/install/>. On Debian and Ubuntu,
  `curl -fsSL https://get.docker.com | sudo sh` is the official convenience script.
- Ports 80 and 443 must be free and open in any firewall (`sudo ss -ltnp | grep -E ':(80|443) '`
  must print nothing). HTTPS certificates are issued over port 80.
- If the domain does not resolve to this server yet, stop and tell the person which DNS record to
  create.

## 3. Install

```bash
curl -fsSL https://raw.githubusercontent.com/aenze/checkdrop/main/install.sh \
  | sudo bash -s -- --domain checks.example.com --json
```

It installs into `/opt/checkdrop` (change with `--dir`). The last line of the output is JSON:

```json
{
  "status": "installed",
  "admin_url": "https://checks.example.com/sign-in",
  "version": "0.1.3",
  "admin_account_exists": false,
  "setup_code": "1a2b3c4d-5e6f7a8b-9c0d1e2f",
  "auto_update": "systemd",
  "address_data": "importing",
  "next_step": "…"
}
```

Running the same command again is safe: it keeps the existing secrets and data.

## 4. Verify

```bash
sudo /opt/checkdrop/checkdrop status --json
```

Expect `"status":"ok"` and `"reachable_from_internet":true`. `address_data.state` is `importing` for
5–15 minutes after installation and then `ready`; address checks switch on by themselves. If
`reachable_from_internet` is `false` right after installation, wait a minute for the certificate and
run the command again.

## 5. Hand over

Tell the person, and nothing more sensitive than this:

- the administration address: `admin_url` from the install output;
- the one-time setup code: `setup_code` (valid until the first account is created);
- that they create their own e-mail and password on that page;
- that updates are automatic and backups are kept in `/opt/checkdrop/backups`.

Next, the person connects a shop in the administration (Connections → Add website) and pastes the
script tag it shows into the shop's checkout.

## Trying it on your own computer instead

For a trial without a server or a domain (macOS, Windows or Linux with Docker Desktop), work in a
clone of the repository; images are built from source, which takes a few minutes the first time:

```bash
git clone https://github.com/aenze/checkdrop.git && cd checkdrop
./checkdrop install --local --json        # http://localhost:8080; ports: --http-port, --https-port
./checkdrop status --json                 # reachable_from_internet is null for a local trial
```

Use `./checkdrop` from the clone instead of `sudo /opt/checkdrop/checkdrop`. A local trial never
schedules automatic updates. The person creates the administrator account in the browser at
`http://localhost:8080/sign-in` with the setup code; do not create it for them.

To remove the trial and all its data:

```bash
docker compose -f compose.yaml -f compose.build.yaml --env-file .env down -v
```

## Errors

Every command ends with JSON containing `"error"` when it fails.

| `error`                                  | What to do                                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docker_missing`, `compose_missing`      | Install Docker Engine with the Compose plugin, then run the installer again.                                                                                             |
| `curl_missing`, `openssl_missing`        | Install curl or openssl with the distribution's package manager (for example `sudo apt-get install -y curl openssl`), then run the installer again.                      |
| `docker_unavailable`                     | Start Docker (`sudo systemctl start docker`) or run with sudo.                                                                                                           |
| `domain_required`, `invalid_domain`      | Pass `--domain` with a plain name such as `checks.example.com`.                                                                                                          |
| `app_unhealthy`, `web_unhealthy`         | `sudo /opt/checkdrop/checkdrop logs app` (or `web`); fix the cause shown, run the installer again. A port already in use is the most common cause.                       |
| `release_unreachable`, `download_failed` | The server cannot reach github.com or ghcr.io over HTTPS; check outbound network.                                                                                        |
| `checksum_mismatch`                      | Stop. Do not bypass it; report it to the person.                                                                                                                         |
| `rolled_back`                            | The update failed and the previous version runs again. See `sudo /opt/checkdrop/checkdrop logs app`; automatic updates skip that version until you run `update` by hand. |
| `busy`                                   | Another update or restore is running; wait for it to finish and try again.                                                                                               |
| `not_installed`                          | There is no `.env` next to this `checkdrop`: use `/opt/checkdrop/checkdrop` (or the `--dir` you installed into), or install first.                                       |

## Never

- Never print, copy or send the contents of `/opt/checkdrop/.env`; it holds the installation's keys.
- Never run `docker compose down -v` or delete Docker volumes on a real installation: that deletes
  all data. It is only for removing a local trial.
- Never set `CHECKDROP_ADMIN_AUTH=external` unless an access proxy already protects the whole site.
- Never expose PostgreSQL (port 5432) or change the firewall beyond opening 80 and 443.

## Day-to-day commands

```bash
sudo /opt/checkdrop/checkdrop status --json        # health, version, address data, updates
sudo /opt/checkdrop/checkdrop update --check       # is a newer release available?
sudo /opt/checkdrop/checkdrop update               # update now (backup, update, rollback on failure)
sudo /opt/checkdrop/checkdrop backup               # database and settings into backups/
echo 'new-long-password' | sudo /opt/checkdrop/checkdrop reset-password admin@example.com
sudo /opt/checkdrop/checkdrop logs app             # last 200 lines of a service
```

More detail: [docs/self-hosting.md](docs/self-hosting.md).
