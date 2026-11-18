# Checkdrop

Zachyťte chybu v e-mailu, telefonu, adrese nebo IČO přímo ve formuláři, dřív než způsobí vrácený
balík, nedoručenou fakturu nebo ztracený kontakt.

Checkdrop kontroluje formulář, zatímco ho člověk vyplňuje: košík e-shopu, poptávku, přihlášku nebo
registraci. Opraví překlep v doméně e-mailu (`gmil.com` → `gmail.com`), sjednotí české telefonní
číslo (`+420 777 123 456`), najde skutečnou adresu v registru RÚIAN a podle IČO doplní firmu z ARES.
Každou opravu potvrdí ten, kdo formulář vyplňuje, jedním kliknutím. Když Checkdrop sám není dostupný,
formulář funguje přesně jako dřív.

[English](README.md) · [Instalace](INSTALL.cs.md) · [checkdrop.dev](https://checkdrop.dev/cs/)

## Jak to funguje

1. **Jeden skript na stránce s formulářem.** Načte z vaší instalace, která pole má kontrolovat
   (nastavíte je v administraci). Žádný balíček, žádný tajný klíč v prohlížeči, žádné úpravy kódu
   webu. Pro WordPress je připravený plugin.
2. **Kontrola při psaní.** Když člověk opustí pole, skript pošle jeho hodnotu na vaši instalaci
   Checkdropu. Ta ji ověří a vrátí výsledek s důvodem.
3. **Návrh, ne přepis.** U chyby se pod polem objeví návrh opravy. Použije se, jen když ho člověk
   potvrdí. Bez potvrzení se sjednotí jen formát telefonu.
4. **Nejdřív jen měření.** Nová pole nic nemění, jen sledují. V monitoru vidíte, co lidé napsali,
   co by Checkdrop navrhl a jak by reagovali. Opravy zapínáte po jednotlivých polích. U každého pole
   zvolíte, jestli Checkdrop jen radí, nebo zastaví i odeslání s údaji, na které nejde doručit.
5. **Výpadek nic nezastaví.** Když Checkdrop neodpoví včas, formulář se odešle jako dřív.

| Pole        | Co Checkdrop ověřuje                                                   | Zdroj                        |
| ----------- | ---------------------------------------------------------------------- | ---------------------------- |
| E-mail      | překlepy v doméně, existence domény a pošty (MX), jednorázové schránky | seznam častých překlepů, DNS |
| Telefon     | platné české číslo, jednotný formát s předvolbou                       | pravidla pro česká čísla     |
| Adresa      | skutečné adresní místo, doplnění PSČ a čísla, adresa mimo Česko        | lokální kopie RÚIAN od ČÚZK  |
| IČO a firma | existence firmy, doplnění názvu, DIČ a sídla                           | ARES                         |
| Jméno       | jméno i příjmení, velká písmena, titul                                 | pravidla pro česká jména     |

## Kde to běží

Každá instalace běží na vašem serveru a má vlastní databázi. Údaje z formulářů k nám ani nikam
jinam neposílá. Ven se připojuje jen pro aktualizace (GitHub), adresy (ČÚZK), údaje firem (ARES), kontrolu
domén e-mailů (DNS) a certifikát HTTPS (Let's Encrypt).
Celé hodnoty v monitoru jsou šifrované a po 90 dnech se mažou.

## Provozujte si to sami, zdarma

Potřebujete jeden linuxový server s Dockerem a doménu, která na něj míří.

```bash
curl -fsSL https://raw.githubusercontent.com/aenze/checkdrop/main/install.sh \
  | sudo bash -s -- --domain kontrola.example.cz
```

Instalátor vygeneruje všechna hesla a klíče, spustí databázi, server, administraci a plánované
úlohy, zajistí certifikát HTTPS a vypíše jednorázový instalační kód. Pak:

1. Otevřete `https://kontrola.example.cz/sign-in` a kódem založte účet správce.
2. V administraci přidejte web a namapujte pole formuláře.
3. Zkopírovaný řádek se skriptem vložte na stránku s formulářem.
4. Nechte Checkdrop pár dní jen měřit a v monitoru zapněte opravy u polí, kterým věříte.

**Dejte to svému AI agentovi.** [INSTALL.cs.md](INSTALL.cs.md) je psaný pro AI agenty, jako je
Claude Code nebo Codex. Dejte agentovi odkaz a přístup na svůj server. Agent tam Checkdrop
nainstaluje, ověří výsledek a předá vám instalační kód.

|                |                                                                         |
| -------------- | ----------------------------------------------------------------------- |
| Server         | 2 CPU, 4 GB paměti, 20 GB disku, Linux s Docker Engine a Compose v2     |
| První spuštění | zhruba minuta, pak se na pozadí stáhnou české adresy (5–15 minut)       |
| Aktualizace    | automaticky každý den: záloha, aktualizace, kontrola, návrat při chybě  |
| Stav           | `./checkdrop status` a přehled v administraci                           |
| Jazyky         | administrace česky i anglicky, skript ve formuláři podle jazyka stránky |

Vyzkoušet to můžete i na svém počítači: v kopii repozitáře spusťte `./checkdrop install --local`
a otevřete <http://localhost:8080>.

## Nebo to nechte na nás

Checkdrop nasadíme na váš server nebo k evropskému poskytovateli podle vaší volby, napojíme vaše
formuláře a nastavíme pole. Na přání ho i provozujeme za vás. Nasazení stojí jednorázově od
9 900 Kč bez DPH podle složitosti napojení. Poptávka na [checkdrop.dev](https://checkdrop.dev/cs/#poptavka).

## Repozitář

| Cesta                                     | Co to je                                          | Licence  |
| ----------------------------------------- | ------------------------------------------------- | -------- |
| `apps/server`                             | API, API administrace, plánované úlohy            | AGPL-3.0 |
| `apps/server/src/embed-script.ts`         | Skript, který běží na stránce s formulářem        | MIT      |
| `apps/web`                                | Administrace (`app`) a web checkdrop.dev (`site`) | AGPL-3.0 |
| `packages/core`                           | Validační pravidla, e-maily a jména               | MIT      |
| `packages/db`                             | PostgreSQL, migrace, import a hledání RÚIAN       | AGPL-3.0 |
| `packages/pack-cz`                        | Česká pravidla: adresy, telefony, IČO, DIČ, texty | MIT      |
| `packages/contracts`                      | Popis API (OpenAPI) a vygenerované typy           | MIT      |
| `integrations/wordpress`                  | Plugin pro WordPress                              | MIT      |
| `checkdrop`, `compose.yaml`, `install.sh` | Instalace, aktualizace, zálohy                    | AGPL-3.0 |

Pro vývoj potřebujete Node.js 24 a pnpm 10:

```bash
pnpm install --frozen-lockfile
pnpm run ci
```

Více v [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) a
[docs/self-hosting.md](docs/self-hosting.md).

## Licence a data

Server, administrace, databázová vrstva a instalační nástroje jsou pod licencí
[GNU Affero General Public License v3.0](LICENSE). Validační jádro, balíčky zemí, skript, který běží
ve vašem formuláři, popis API a plugin pro WordPress jsou pod MIT. Pokud upravený Checkdrop nabízíte
dalším přes síť, AGPL vyžaduje zveřejnit vaše úpravy.

Adresní data © ČÚZK, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.cs). Každá
instalace si je stahuje přímo od ČÚZK, v repozitáři nejsou. Údaje firem jdou živě z ARES. Více
v [DATA_SOURCES.md](DATA_SOURCES.md).

Checkdrop je projekt Aenze. Název „Checkdrop“ a logo patří společnosti Aenze s.r.o.; licence se týkají
kódu, ne názvu.
