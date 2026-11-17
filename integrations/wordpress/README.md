# Checkdrop pro WordPress — pilotní základ 0.1.0

Univerzální konektor, bez závislosti na WooCommerce nebo konkrétní doméně. Nevkládá vlastní validace ani nesbírá formulářová data v PHP. Veřejný skript používá pouze pole namapovaná v Checkdropu. Podpora všech formulářových pluginů není automaticky zaručena.

## Instalace

1. V Checkdropu založte integraci pro správnou doménu a nastavte sledování bez asistovaných změn. Namapujte povolená pole; hesla, souhlasy a platební údaje nikdy nemapujte.
2. Nahrajte ZIP pluginu do WordPress → Pluginy → Instalace pluginů. Aktivace sama skript nezapíná.
3. Nastavení → Checkdrop: vložte veřejný klíč `cdp_site_…`, povolte skript a uložte. Soukromý API klíč plugin nevyžaduje.
4. Vymažte cache, vyplňte syntetický test a v Checkdropu ověřte příjem. Teprve pak postupně povolujte asistenci.

Nastavení používá WordPress Settings API s kontrolou oprávnění a nonce. Skript se vkládá standardním enqueue API. Plugin nijak nevolá databázi e-shopových objednávek ani ABRA API.

## Bezpečné hranice

- Skript pochází výhradně z `https://api.checkdrop.dev/v1/embed.js`. Služba přijímá namapované kontaktní údaje podle konfigurace účtu; provozovatel musí před zapnutím vyřešit informování zákazníků a podmínky zpracování.
- Plugin nelže o spojení: uložený klíč není potvrzení příjmu ani sledovacího režimu. Režim a skutečné události se ověřují v Checkdropu.
- Odstraňte ruční/GTM instalaci. Loader přeskočí už existující embed; ochrana proti pozdějšímu duplicitnímu spuštění vyžaduje také novou verzi serverového runtime.
- Deaktivace brání vložení do nových stránek; cache a již otevřené stránky mohou obsahovat starý skript. Pro okamžité centrální vypnutí pozastavte integraci a ověřte výsledek.
- Každý web v multisite má vlastní konfiguraci. Hromadné nastavení a síťové odinstalování nejsou součástí tohoto pilotního vydání.
- Klasické HTML formuláře vyžadují mapování; WooCommerce Blocks a další řízené komponenty potřebují samostatné ověření/adaptér. Toto vydání jejich automatické opravy negarantuje.

## Otevřené body před produkčním pilotem

Klasický i blokový checkout; registrace, dynamické sekce, oddělené adresy, cache a CSP; potvrzená konfigurace shadow; podepsané oznámení objednávky a oddělení dalšího nákupu. ZIP je vývojový artefakt, ne certifikace kompatibility.

Ověřeno 7. 9. 2026 v dočasném WordPressu (image hlásí WP 7.1, PHP 8.2.33), bez WooCommerce: aktivace s výchozím vypnutím, uložení veřejného klíče a přepínače, vložení jednoho skriptu, vypnutí, rozložení 1280 px / 390 px. Vnější požadavky byly při browser testu blokovány; příjem dat produkčním API nebyl testován. Starší deklarované minimum WP/PHP vyžaduje další kompatibilitní matici. Snímky a reprodukovatelný test jsou v `tests/`.

## Sestavení

Z adresáře `integrations/wordpress` spusťte `zip -r /private/tmp/checkdrop-wordpress-0.1.0.zip checkdrop`. Archiv obsahuje pouze plugin, ne testy ani konfiguraci účtu.

Oficiální rozhraní: [Settings API](https://developer.wordpress.org/plugins/settings/settings-api/), [enqueue](https://developer.wordpress.org/reference/functions/wp_enqueue_script/).
