# Instalace Checkdropu — návod pro AI agenty i lidi

Tento návod je napsaný tak, aby Checkdrop nainstaloval AI agent bez doptávání. Zvládne ho i člověk.
Příkazy, výstupy a chybové kódy jsou stejné jako v [anglické verzi](INSTALL.md), která je pro
agenty hlavní.

**Cíl:** běžící instalace Checkdropu na `https://<doména>`, zdravá, dostupná z internetu,
a jednorázový instalační kód předaný člověku, který ji bude spravovat.

## 1. Co potřebujete od člověka

- **Přístup přes SSH** na linuxový server (Debian, Ubuntu a podobné, 64bit) jako root nebo s sudo.
- **Doménu**, jejíž záznam DNS A (a AAAA, má-li server IPv6) míří na tento server, například
  `kontrola.example.cz`.

Nic dalšího nechtějte. Hesla a klíče si instalátor vygeneruje sám.

## 2. Kontrola serveru

```bash
uname -m                      # x86_64 nebo aarch64
nproc; free -g; df -h /       # aspoň 2 CPU, 4 GB paměti, 20 GB volného disku
docker version --format '{{.Server.Version}}'
docker compose version
getent hosts kontrola.example.cz   # musí vypsat veřejnou IP tohoto serveru
```

- Chybí-li Docker, nainstalujte Docker Engine podle oficiálního návodu:
  <https://docs.docker.com/engine/install/>.
- Porty 80 a 443 musí být volné a otevřené ve firewallu. Certifikát HTTPS se vydává přes port 80.
- Pokud doména ještě nemíří na server, zastavte se a řekněte člověku, jaký záznam DNS má založit.

## 3. Instalace

```bash
curl -fsSL https://raw.githubusercontent.com/aenze/checkdrop/main/install.sh \
  | sudo bash -s -- --domain kontrola.example.cz --json
```

Instaluje se do `/opt/checkdrop`. Poslední řádek výstupu je JSON s `admin_url` a `setup_code`.
Opakované spuštění je bezpečné, hesla ani data nepřepíše.

## 4. Ověření

```bash
sudo /opt/checkdrop/checkdrop status --json
```

Očekávejte `"status":"ok"` a `"reachable_from_internet":true`. Adresy mají 5–15 minut stav
`importing`, pak `ready` a kontrola adres se zapne sama.

## 5. Předání

Člověku předejte jen adresu administrace (`admin_url`) a jednorázový instalační kód (`setup_code`).
Účet si založí sám svým e-mailem a heslem. Aktualizace běží automaticky a zálohy jsou
v `/opt/checkdrop/backups`.

## Zkouška na vlastním počítači

Bez serveru a domény (macOS, Windows nebo Linux s Docker Desktop) pracujte v kopii repozitáře:

```bash
git clone https://github.com/aenze/checkdrop.git && cd checkdrop
./checkdrop install --local --json        # http://localhost:8080
```

Místo `sudo /opt/checkdrop/checkdrop` používejte `./checkdrop`. Zkušební instalace nikdy nezapíná
automatické aktualizace. Účet správce si člověk založí v prohlížeči. Odstranění i s daty:
`docker compose -f compose.yaml -f compose.build.yaml --env-file .env down -v`.

## Nikdy

- Nevypisujte ani neposílejte obsah `/opt/checkdrop/.env`, jsou v něm klíče instalace.
- Nespouštějte `docker compose down -v` a nemažte svazky Dockeru, smazali byste všechna data.
- Nenastavujte `CHECKDROP_ADMIN_AUTH=external`, pokud celý web už nechrání přístupová brána.
- Neotevírejte PostgreSQL (port 5432) ani neměňte firewall nad rámec portů 80 a 443.

Chybové kódy, běžné příkazy a podrobnosti jsou v [INSTALL.md](INSTALL.md) a
[docs/self-hosting.md](docs/self-hosting.md).
