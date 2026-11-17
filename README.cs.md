# Checkdrop

Zachyťte chyby v údajích zákazníka v košíku dřív, než se z nich stane vrácený balík.

Checkdrop kontroluje objednávkový formulář, zatímco zákazník píše: překlepy v doméně e-mailu
(`gmil.com` → `gmail.com`), česká telefonní čísla (`+420 777 123 456`), skutečné české adresy
z registru RÚIAN, údaje firmy z ARES podle IČO a adresy, které nepatří do e-shopu doručujícího jen
v ČR. Zákazník každou opravu potvrdí jedním kliknutím. U každého pole zvolíte, jestli
Checkdrop jen nabídne opravu, nebo zastaví i objednávku s údaji, na které nejde doručit. Když Checkdrop
sám není dostupný, košík funguje přesně jako dřív.

[English](README.md) · [Instalace](INSTALL.cs.md) · [checkdrop.dev](https://checkdrop.dev/cs/)

## Provozujte si to sami

Potřebujete jeden linuxový server s Dockerem a doménu, která na něj míří.

```bash
curl -fsSL https://raw.githubusercontent.com/aenze/checkdrop/main/install.sh \
  | sudo bash -s -- --domain kontrola.example.cz
```

Instalátor vygeneruje všechna hesla a klíče, spustí databázi, server, administraci a plánované
úlohy, zajistí certifikát HTTPS a vypíše jednorázový instalační kód. Otevřete
`https://kontrola.example.cz/sign-in`, kódem založte účet správce, připojte e-shop a vložte do košíku
jeden skript.

**Dejte to svému AI agentovi.** [INSTALL.cs.md](INSTALL.cs.md) je psaný pro AI agenty, jako je
Claude Code nebo Codex: dejte agentovi odkaz a přístup na server, on nainstaluje, ověří výsledek
a předá vám instalační kód.

| | |
| --- | --- |
| Server | 2 CPU, 4 GB paměti, 20 GB disku, Linux s Docker Engine a Compose v2 |
| První spuštění | zhruba minuta, pak se na pozadí stáhnou české adresy (5–15 minut) |
| Aktualizace | automaticky každý den: záloha, aktualizace, kontrola, návrat při chybě |
| Jazyky | administrace česky i anglicky, košík podle jazyka stránky e-shopu |

Vyzkoušet to můžete i na svém počítači: v kopii repozitáře spusťte `./checkdrop install --local`
a otevřete <http://localhost:8080>.

## Nebo to udělejte s námi

Nainstalujeme Checkdrop na váš server nebo k evropskému poskytovateli podle vaší volby, napojíme ho
na e-shop a udržujeme aktuální data adres a firem. Od 9 900 Kč.
[checkdrop.dev](https://checkdrop.dev/cs/)

## Jak to funguje

- **Jeden skript** v e-shopu načte mapování polí, které nastavíte v administraci. Žádný balíček,
  žádný tajný klíč v prohlížeči, žádné úpravy kódu e-shopu.
- **Začněte sledováním.** Nová pole jen sledují a monitor ukáže, co by Checkdrop zachytil. Opravy
  zapínáte po jednotlivých polích, až jim věříte.
- **Data zůstávají u vás.** Každá instalace má vlastní databázi. Celé hodnoty v monitoru jsou
  šifrované a po 90 dnech se mažou.
- **Všude stejná aplikace.** Hostovaná služba na checkdrop.dev běží ze stejných obrazů jako každá
  vlastní instalace. Liší se jen data a napojení.

## Licence a data

Server, administrace, databázová vrstva a instalační nástroje jsou pod licencí
[GNU Affero General Public License v3.0](LICENSE). Validační jádro, balíčky zemí, skript, který běží
ve vašem e-shopu, popis API a plugin pro WordPress jsou pod MIT. Pokud upravený Checkdrop nabízíte dalším přes síť, AGPL vyžaduje
zveřejnit vaše úpravy.

Adresní data © ČÚZK, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.cs). Každá
instalace si je stahuje přímo od ČÚZK, v repozitáři nejsou. Údaje firem jdou živě z ARES. Více
v [DATA_SOURCES.md](DATA_SOURCES.md).

Název „Checkdrop“ a logo patří společnosti Aenze s.r.o.; licence se týkají kódu, ne názvu.
