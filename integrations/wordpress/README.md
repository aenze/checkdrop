# Checkdrop pro WordPress

Univerzální konektor, bez závislosti na WooCommerce nebo konkrétní doméně. Nevkládá vlastní validace ani nesbírá formulářová data v PHP. Veřejný skript používá pouze pole namapovaná v Checkdropu. Podpora všech formulářových pluginů není automaticky zaručena.

## Instalace

1. V Checkdropu založte integraci pro správnou doménu a nastavte sledování bez asistovaných změn. Namapujte povolená pole; hesla, souhlasy a platební údaje nikdy nemapujte.
2. Nahrajte ZIP pluginu do WordPress → Pluginy → Instalace pluginů. Aktivace sama skript nezapíná.
3. Nastavení → Checkdrop: vložte veřejný klíč `cdp_site_…`, u vlastní instalace vyplňte pole Server Checkdropu (např. `https://kontrola.example.cz`), povolte skript a uložte. Soukromý API klíč plugin nevyžaduje.
4. Vymažte cache, vyplňte syntetický test a v Checkdropu ověřte příjem. Teprve pak postupně povolujte asistenci.

Nastavení používá WordPress Settings API s kontrolou oprávnění a nonce. Skript se vkládá standardním enqueue API. Plugin nečte databázi objednávek ani nevolá jiná API.

## Bezpečné hranice

- Skript se načítá z `https://api.checkdrop.dev/v1/embed.js`, nebo z adresy vaší vlastní instalace nastavené v poli Server Checkdropu (jen `https://`). Služba přijímá namapované kontaktní údaje podle konfigurace; provozovatel musí před zapnutím vyřešit informování zákazníků a podmínky zpracování.
- Plugin nelže o spojení: uložený klíč není potvrzení příjmu ani sledovacího režimu. Režim a skutečné události se ověřují v Checkdropu.
- Odstraňte ruční/GTM instalaci. Loader přeskočí už existující embed.
- Deaktivace brání vložení do nových stránek; cache a již otevřené stránky mohou obsahovat starý skript. Pro okamžité centrální vypnutí pozastavte integraci v Checkdropu a ověřte výsledek.
- Každý web v multisite má vlastní konfiguraci. Hromadné nastavení a síťové odinstalování nejsou podporované.
- Klasické HTML formuláře vyžadují mapování; WooCommerce Blocks a další řízené komponenty potřebují samostatné ověření. Plugin jejich automatické opravy negarantuje.

## Sestavení

ZIP vzniká automaticky při vydání (`checkdrop-wordpress-<verze>.zip`).

Oficiální rozhraní: [Settings API](https://developer.wordpress.org/plugins/settings/settings-api/), [enqueue](https://developer.wordpress.org/reference/functions/wp_enqueue_script/).
