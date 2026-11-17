=== Checkdrop ===
Requires at least: 6.3
Requires PHP: 8.1
Stable tag: 0.2.0
License: MIT
License URI: https://opensource.org/license/mit

Univerzální konektor WordPress formulářů ke službě Checkdrop. Pilotní vydání.

== Instalace ==
1. Nahrajte ZIP a aktivujte plugin.
2. V Checkdropu založte integraci pro doménu, namapujte povolená pole a nastavte sledování bez oprav.
3. Ve WordPressu otevřete Nastavení > Checkdrop, vložte veřejný klíč cdp_site_ a povolte skript.
4. Ověřte příjem syntetického testu v Checkdropu. Potom zapínejte jednotlivé asistence.

Plugin nevyžaduje WooCommerce. Opravy konkrétních formulářů včetně WooCommerce Checkout Blocks je třeba samostatně ověřit.

== Externí služba a data ==
Po výslovném povolení načítá plugin skript z https://api.checkdrop.dev/v1/embed.js.
Skript načítá konfiguraci a odesílá namapované kontaktní údaje k validaci a monitorování do Checkdropu podle nastavení účtu.
Nevkládejte soukromé API klíče. Nemapujte hesla, platební údaje ani souhlasy.
Před aktivací uzavřete potřebné podmínky zpracování s poskytovatelem a informujte návštěvníky.
Administrace služby: https://app.checkdrop.dev/integrations

== Vypnutí ==
Zrušte povolení v Nastavení > Checkdrop a vymažte cache. Odstraňte případnou ruční/GTM instalaci. Otevřené stránky obnovte.
Deaktivace nebo odinstalování pluginu nemaže vzdálená zákaznická data. Odinstalování odstraní lokální nastavení daného webu.

== Rozsah ==
Režim validace se řídí konfigurací Checkdropu, nikoli přepínačem pluginu. Uložený klíč není důkaz funkčního spojení.
Automatické mapování všech formulářových pluginů ani serverové potvrzení objednávky zatím nejsou součástí vydání.
