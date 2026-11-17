# Seznam e-mailových poskytovatelů pro opravy

`czEmailRules.providerDomains` (mezinárodní poskytovatelé z `internationalEmailRules` v jádru a české z `czEmailRuleAdditions`) slouží jen jako cíle oprav a ochrana platných variant před vzájemným převodem. Není to seznam povolených domén: e-mail s jinou doménou se přijme normálně, pokud má doména DNS.

| Doména | Zdroj | Ověřeno |
| --- | --- | --- |
| gmail.com, seznam.cz, email.cz, centrum.cz, outlook.com, hotmail.com, yahoo.com, icloud.com, atlas.cz, volny.cz | cíle dosavadního katalogu `domainCorrections` | převzato z katalogu |
| proton.me, protonmail.com, pm.me, protonmail.ch | [Proton — adresy a aliasy](https://proton.me/support/addresses-and-aliases) | 19. 9. 2026, podle specifikace |
| gmx.de, gmx.net, gmx.at, gmx.ch | [GMX — e-mailové domény](https://www.gmx.net/mail/e-mail-adressen/) | 19. 9. 2026, podle specifikace |

Nová doména patří do seznamu jen se zdrojem, datem ověření a pozitivními i negativními testy. Počet domén sám není měřítkem kvality.
