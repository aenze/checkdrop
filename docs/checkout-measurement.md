# Měření průchodu košíkem

Události se sbírají pouze pro namapovaný formulář. `started` znamená první editaci mapovaného pole, nikoliv návštěvu košíku. Aktivita se vzorkuje nejvýše jednou za 30 sekund. `submit_attempt` je pokus, `submit_dispatched` pouze nezrušená browserová událost submit; ani jedno nepotvrzuje vytvoření či zaplacení objednávky. `page_left` může být běžný přechod na platbu nebo obnovení stránky.

`blocked` obsahuje pouze pevný kód důvodu a kanonické pole. Vlastní kontrola Checkdropu rozlišuje chybějící celé jméno. Nativní validace rozlišuje povinné pole / formát. U Nette se čte pouze odkaz na chybné pole, nikoliv zpráva s případnými osobními údaji. Obecně zrušený submit je označen `shop_cancelled` a může znamenat také AJAX odeslání; není automaticky chybou.

Endpoint `POST /v1/checkout/events?site=…&form=…&session=…` vyžaduje stejné origin ověření a aktivní napojení jako validace. Přijímá jen `event_id` (UUID v4), `event`, `source`, `reason`, `field`, `context`. Nepřijímá kontaktní hodnoty ani URL. Session je na serveru HMAC stejným způsobem jako u kontrol polí. Duplicitní event ID se ukládá jen jednou. Měření má samostatný rate-limit rozpočet a nesmí ubírat kapacitu validacím. Selhání měření nic neblokuje.

Pro QA otevřete košík s `?checkdrop_test=1` (nebo `&checkdrop_test=1`). Označení je explicitní, nikoli automatická detekce robota; neoznačené testy nelze spolehlivě odlišit od zákazníků. Monitor standardně označené testy skryje. Retence je 90 dní, mazání provádí existující cleanup úloha.

Operátorský endpoint `GET /v1/operator/checkout-sessions` je chráněný stávajícím operátorským oprávněním a omezený na projekt. Vrací posledních 24 hodin a nejvýše 100 relací; lze zadat `from` a `include_tests=1`. Relace se propojuje s kontrolami přes session_ref a formulář. Záznamy chybějící kvůli adblocku či výpadku nelze dopočítat.

## Potvrzení hlášené prohlížečem

Runtime pasivně čte existující i nově vložené objekty `dataLayer` s eventem `purchase` nebo `purchase_velkoobchod` a neprázdným `ecommerce.transaction_id`. Nepřepisuje push ani nevyvolává marketingové události. Vyžaduje předchozí interakci s namapovaným formulářem v témže sessionStorage, nejvýše 24 hodin starou. Před zahájením nové interakce zahodí již přítomné staré události. Při nedostupném úložišti nebo API nic neblokuje. Síťové chyby opakuje nejvýše třikrát.

Endpoint navíc přijímá `purchase_reported` s `order_ref` (1–80 ASCII písmen/číslic, pomlčka/podtržítko) a `purchase_channel` b2c/b2b. Číslo objednávky ukládá pouze jako HMAC, oddělený podle integrace a testovacího zdroje. Unikátní index zamezí opakovanému započtení stejné objednávky. Retence zůstává 90 dní. Sběr nekopíruje celý dataLayer, e-mail, produkty ani hodnotu nákupu.

Monitor označuje výsledek jako objednávku hlášenou e-shopem z prohlížeče; nejde o potvrzení platby ani ověření serverem. B2B není důkaz objednávky obchodního zástupce. První skutečný zachycený nákup je třeba porovnat s administrací.

## Původní diagnostika před rozšířením

Potvrzovací DOM/URL ani backendové potvrzení vzniku objednávky nebylo zatím ověřeno. Žádný browserový event `order_confirmed` endpoint nepřijímá. Monitor proto po 30 minutách píše „Neaktivní, výsledek neznámý“, nikoli opuštěný košík a nepočítá dropout %. K dokončení je třeba ověřený signál z děkovací stránky (browserem hlášené dokončení) nebo serverové potvrzení vytvořené objednávky. Události z platební brány a změna URL samy nestačí. Historii před zapnutím nelze rekonstruovat.
