# Checkdrop pilot API

Tento dokument popisuje cílový kontrakt českého pilotu pro `https://api.checkdrop.dev`. Zdrojový
OpenAPI kontrakt je v `packages/contracts/openapi.yaml`. Označení `implemented-pilot` potvrzuje stav
zdrojového kódu a testů, nikoliv samo o sobě nasazení nové verze do produkce. Operátorský monitor je
oddělený za Cloudflare Access na `https://app.checkdrop.dev` a není dostupný přes veřejnou API
doménu.

## Veřejné cesty

| Metoda | Cesta | Autentizace | Účel |
| --- | --- | --- | --- |
| `GET` | `/v1/health` | bez klíče | dostupnost procesu |
| `GET` | `/v1/capabilities` | bez klíče | publikované schopnosti a jejich zralost |
| `POST` | `/v1/names/validate` | `X-Checkdrop-Key` | společné pole jméno a příjmení, tituly a bezpečné formátování |
| `POST` | `/v1/emails/validate` | `X-Checkdrop-Key` | formát, normalizace, doména a DNS/MX |
| `POST` | `/v1/phones/validate` | `X-Checkdrop-Key` | český formát a normalizace čísla |
| `POST` | `/v1/addresses/validate` | `X-Checkdrop-Key` | úplnost kontaktu a shoda adresy s RÚIAN |
| `POST` | `/v1/addresses/autocomplete` | `X-Checkdrop-Key` | české adresní návrhy z lokálního RÚIAN |
| `POST` | `/v1/company-ids/validate` | `X-Checkdrop-Key` | formát IČO, kontrolní součet a ARES |
| `POST` | `/v1/companies/autocomplete` | `X-Checkdrop-Key` | hledání české firmy názvem nebo přesným IČO |
| `POST` | `/v1/assist/interactions` | `X-Checkdrop-Key` nebo omezené veřejné ID webu | zobrazení, použití, ponechání nebo vrácení konkrétní opravy |

Veřejná doména záměrně nepublikuje operátorské trasy. Neznámá nebo interní cesta vrací `404`.

## Společná pravidla

- Klíč patří do serverového secret store, nikdy do prohlížeče, HTML, URL, cookies ani tag manageru.
- Browser volá same-origin proxy e-shopu. Proxy přidá klíč a pevný identifikátor integrace.
- JSON tělo má limit 8 KiB a odpověď používá `Cache-Control: no-store`.
- `Idempotency-Key` má 1–128 znaků. Pokud chybí, server použije vlastní request ID.
- `Server-Timing: checkdrop;dur=…` uvádí dobu práce API.
- Timeout, `429`, `5xx`, neplatná odpověď nebo nedostupný externí zdroj nesmí zablokovat checkout.
- Český pilot přijímá pouze `country: "CZ"`.

## Kontrola jména a titulů

Kontrola společného pole zachovává jméno, příjmení, iniciály a známé tituly. Bezpečně opravuje
mezery a jednoznačnou velikost písmen, například `MUDr.Michal POřický` navrhne jako
`MUDr. Michal Pořický`. Stejným způsobem zachovává pomlčky, apostrofy a částice ve jménech jako
`Anna-Marie Dvořáková`, `Jean O'Neill` nebo `Ludwig van Beethoven`.

Checkdrop nedoplňuje chybějící diakritiku a nehádá pravopis neznámého jména. Neobvyklé smíšené
psaní proto vrátí jako `risky` bez návrhu. Číslice, emoji a poškozené oddělovače jsou `invalid`.
Tituly se nezapočítávají jako jméno nebo příjmení, takže samotné `MUDr. Novák` zůstává neúplné.
V shadow režimu se návrh pouze zaznamená do chráněného monitoru a hodnotu formuláře nemění.
V asistovaném režimu se u jednoslovného jména zobrazí neblokující vysvětlení, že jméno i příjmení
pomohou dopravci zásilku správně doručit bez dodatečného telefonátu. Bezpečná úprava formátování se
nabídne k potvrzení; Checkdrop jméno nikdy nedoplní ani nezmění bez volby zákazníka.

Formulář může mít jedno společné pole `full_name` nebo samostatná pole `first_name` a `last_name`.
Po ručním doplnění obou částí zmizí upozornění a u pole se zobrazí jen přístupná zelená značka
„Jméno je v pořádku“ bez potvrzovacího tlačítka. Jméno kontaktní osoby se kontroluje i u firmy.

## Firemní našeptávač ARES

`POST /v1/companies/autocomplete` přijímá dotaz od tří znaků a vrací nejvýše pět firem. Název se
hledá v ARES, přesné osmimístné IČO používá stejnou validaci jako `/v1/company-ids/validate`.
ARES nepodporuje hledání podle neúplného IČO; numerická předvolba proto může nabídnout pouze firmu,
kterou server nedávno jednoznačně načetl a drží v krátké cache. Nevrácený výsledek se nesmí hádat.

Odpověď obou firemních operací používá stejný objekt `company` s názvem, normalizovaným IČO,
volitelným DIČ a strukturovaným sídlem. Po výběru firmy hostovaný skript atomicky doplní pouze
namapovaná firemní a fakturační pole. Doručovací adresu ARES nikdy nemění. Stav
„Firemní údaje doplněny z ARES“ nabízí volbu **Vrátit**; ta obnoví jen pole, která zákazník od
doplnění sám nezměnil. Timeout, omezení nebo nedostupnost ARES nic nezmění a formulář neblokují.

## Adresní autocomplete

Autocomplete používá aktivní lokální snapshot RÚIAN. Nevolá zahraniční adresní API a neposílá
adresní dotaz třetí straně.

```http
POST https://api.checkdrop.dev/v1/addresses/autocomplete
Content-Type: application/json
X-Checkdrop-Key: <serverový klíč>
X-Checkdrop-Client: example-shop-checkout/1.0
X-Checkdrop-Mode: shadow
Idempotency-Key: <náhodné ID dotazu>
```

```json
{
  "query": "Dlouhá 1 Praha",
  "country": "CZ",
  "limit": 6
}
```

Odpověď:

```json
{
  "object": "address_suggestion_list",
  "request_id": "…",
  "status": "matched",
  "country": "CZ",
  "suggestions": [
    {
      "id": "21725721",
      "label": "Dlouhá 928/1, Staré Město, 110 00 Praha 1",
      "street_line": "Dlouhá 928/1",
      "street": "Dlouhá",
      "house_number": "928",
      "orientation_number": "1",
      "city": "Praha",
      "city_part": "Staré Město",
      "postal_code": "11000"
    }
  ],
  "evidence": [
    {
      "source": "ruian",
      "checked_at": "…",
      "state": "confirmed",
      "detail": "ruian.snapshot.…"
    }
  ]
}
```

`status` může být:

- `matched` – alespoň jeden návrh;
- `no_match` – RÚIAN je dostupný, ale návrh nebyl nalezen;
- `unavailable` – lokální zdroj je dočasně nedostupný; formulář pokračuje bez našeptávání.

### Chování ve formuláři

1. Dotaz spustit po nejméně třech znacích a 250–350 ms bez psaní.
2. Předchozí rozpracovaný požadavek při další změně zrušit.
3. Zobrazit nejvýše šest návrhů a podporovat čtečku obrazovky.
4. Pole vyplnit pouze po výslovném výběru zákazníka.
5. Použít `street_line`, `city` a `postal_code` ze zvoleného návrhu, nikoliv znovu rozebírat
   `label`.
6. Při chybě, timeoutu nebo prázdném seznamu ponechat ruční zadání beze změny.

## Kontrola e-mailu

Aktuální kontrola provádí:

- syntaktickou kontrolu a normalizaci domény;
- detekci vybraných běžných překlepů českých a globálních domén;
- upozornění na vybrané disposable domény a role typu `info@` nebo `support@`;
- skutečný DNS dotaz na MX a adresní záznamy s dvousekundovým deadlinem;
- `unknown / fail_open`, pokud DNS nelze bezpečně vyhodnotit.

Tato operace nepotvrzuje existenci konkrétní schránky ani vlastnictví e-mailu. Takové tvrzení
vyžaduje buď specializovanou mailbox-verification službu, nebo potvrzovací zprávu s odkazem/OTP.

U známého překlepu API vrátí `status: "correctable"`, kód `email.domain_typo` a celý opravený
e-mail v poli `suggestion`. Integrace má zobrazit kompaktní otázku „Opravit na …?“ a hodnotu
změnit jen po kliknutí zákazníka. Pilot obsahuje konzervativní seznam variant pro tyto
časté poskytovatele:

| Správná doména | Příklady rozpoznaných překlepů |
| --- | --- |
| `gmail.com` | `gmil.com`, `gmial.com`, `gmeil.com`, `gmelj.com`, `gamil.com`, `gmail.co` |
| `seznam.cz` | `sezman.cz`, `sezam.cz`, `sznam.cz` |
| `email.cz` | `emial.cz`, `emai.cz` |
| `centrum.cz` | `centum.cz`, `cenrum.cz` |
| `outlook.com` | `outlok.com`, `outllok.com` |
| `hotmail.com` | `hotmial.com`, `hotmal.com` |
| `yahoo.com` | `yaho.com`, `yahoo.co` |
| `icloud.com` | `iclud.com`, `iclou.com` |

Neznámá doména se neopravuje podle obecné podobnosti. Tím se omezuje riziko, že Checkdrop změní
méně známou, ale správnou firemní doménu.

## Postupné zapínání v hostovaném skriptu

V administraci se každé namapované pole nastavuje samostatně:

- **Nevalidovat** – pole se vůbec neposílá;
- **Jen sledovat** – Checkdrop výsledek pouze zaznamená; formulář se nemění;
- **Upozornit a nabídnout opravu** – pro celé jméno. Jednoslovné jméno zobrazí stručné vysvětlení,
  bezpečné formátování lze potvrdit a nejasné jméno se nikdy nepřepíše;
- **Nabídnout opravu** – pro e-mail. Po opuštění pole se u známého překlepu zobrazí na jednom
  řádku „Opravit na …?“ s volbami **Opravit** a **Ponechat**;
- **Automaticky formátovat** – pro český telefon. Číslice se bezpečně skládají do jednotného
  formátu už během psaní a po potvrzení čísla se zobrazí volba **Vrátit původní**;
- **Nabízet adresy** – pro českou ulici. Výběr konkrétní shody z RÚIAN doplní ulici, město a PSČ;
  nabídku lze zavřít pokračováním v ručním psaní a použitou adresu lze vrátit.
- **Doplňovat firmu** – pro název firmy a IČO. Výběr jedné firmy doplní firemní a fakturační skupinu
  z ARES jako jeden vratný krok; doručovací skupina zůstane beze změny.

Telefonní pole používá klávesnici pro telefon, ukazuje český vzor `+420 777 762 456` a při psaní
průběžně seskupuje číslice po třech. Například `777123456` se během zadávání změní na
`+420 777 123 456`; zákazník může jedním kliknutím obnovit původní zápis.
Příliš krátké, dlouhé nebo zahraniční číslo zobrazí pod polem vysvětlení, ale hodnotu nepřepíše a
objednávku nezablokuje. Chybějící číslice se nedoplňují a cizí nebo neplatné číslo se nepřepisuje.
Jméno, e-mail a telefon se vyhodnotí po opuštění pole; adresní a firemní návrhy vznikají průběžně
při psaní. Formulář se nikdy neblokuje. Při timeoutu, chybě nebo nejasném
výsledku se žádná automatická změna neprovede a objednávka pokračuje. Stávající jediný `<script>`
tag na e-shopu zůstává stejný; po uložení mapování si skript načte novou konfiguraci sám.

Jedna stránka může vrátit `forms[]` s více profily. Každý profil má vlastní `root_selector`, takže
checkout, registrace a modal na stejné URL sledují pouze svůj DOM kořen. Fakturační pole mají
kontext `billing`, jiná doručovací adresa `shipping`; RÚIAN ani ARES mezi těmito skupinami hodnoty
nekopírují. Pole pod `profile_details_enabled` a `alternate_shipping_enabled` se vyhodnocují až po
zobrazení příslušné části. Hesla, newsletter a souhlasy se nemapují ani neposílají. Starý objekt
`form + fields` zůstává po přechodnou dobu v odpovědi kvůli kompatibilitě.

Zobrazení a výsledek opravy se ukládají k původnímu zašifrovanému záznamu. Chráněný monitor proto
ukáže konkrétní jméno, e-mail, telefon nebo adresu, návrh a výsledek `Opraveno`, `Ponecháno`,
`Automaticky upraveno`, `Adresa doplněna` nebo `Vráceno`. U adresy se uloží skutečně vybraná
varianta. Retence zůstává 90 dní a data nejsou dostupná z veřejného monitoru.

```json
{
  "email": "jan.novak@gmil.com",
  "policy": "assist"
}
```

Nejdůležitější kódy:

| Kód | Význam |
| --- | --- |
| `email.syntax_invalid` | neplatná syntaxe |
| `email.domain_typo` | známý pravděpodobný překlep domény |
| `email.domain_no_dns` | doména nemá použitelný DNS záznam |
| `email.domain_no_mx` | chybí MX, používá se adresní fallback |
| `email.domain_disposable` | známá dočasná doména |
| `email.local_role` | sdílená role místo osobní schránky |

## Technické chyby

| HTTP | Chování integrace |
| --- | --- |
| `400` | chyba kontraktu; opravit integraci |
| `401` | chybějící nebo neplatný API klíč |
| `413` | tělo překročilo 8 KiB |
| `415` | požadavek není `application/json` |
| `429` | respektovat `Retry-After`, checkout neblokovat |
| `503` | dočasná nedostupnost, selhat otevřeně |

## Co zatím není součástí pilotu

- zahraniční adresy;
- pasivní potvrzení existence konkrétní e-mailové schránky;
- aktivní stav nebo dosažitelnost telefonu v síti operátora;
- automatické přepsání údajů bez rozhodnutí zákazníka;
- veřejné importy, monitor, billing a správa klíčů.
