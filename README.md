# PRAUT Domény

Klientské vyhledávání a objednávání domén pro `domeny.praut.cz`.

## Spuštění

```bash
npm start
```

Web poběží na `http://localhost:3000`. Projekt vyžaduje Node.js 24 a `npm install`.

## E-mail objednávky a zálohová faktura

Každá objednávka se uloží do `data/orders.jsonl`. Klient zadá fakturační jméno, adresu a e-mail. PRAUT není plátcem DPH, proto se k uvedeným cenám DPH nepřičítá. Objednávka vytvoří zálohovou fakturu / výzvu k platbě se splatností 14 dní a pošle ji jako PDF přílohu spolu s HTML a textovou verzí e-mailu. Platba je směrována na ověřený účet PRAUT s.r.o. Pro odesílání nastavte na serveru:

```bash
RESEND_API_KEY=re_xxx
NOTIFY_EMAIL=objednavky@praut.cz
NOTIFY_FROM="PRAUT Domény <domeny@praut.cz>"
PAYMENT_DUE_DAYS=14
```

Volitelně lze nastavit `ORDER_WEBHOOK_URL` na příchozí webhook Slacku, Teams, Discordu nebo scénáře v Make. Oznámení majiteli i webhook zůstávají zachované. Doména odesílatele musí být u e-mailové služby ověřená. Když odeslání klientovi selže, API vrátí přijetí objednávky s pravdivou informací, že výzva ještě nebyla odeslána. Před ostrým provozem je třeba vyřešit spolehlivé opakování a ruční dořešení neúspěšných doručení.

Fiktivní ukázku e-mailu a PDF vytvoří `npm run preview` do `preview/`. Obsahuje viditelné označení UKÁZKA a nevytváří žádné skutečné odeslání. Písma v `assets/fonts/` pocházejí z Google Fonts Montserrat a podléhají přiložené licenci OFL.

## Produkční integrace

Doporučená cesta pro PRAUT je reseller účet Subreg/Gransy (česká podpora, `.cz`, 900+ TLD, SOAP/EPP, white-label), případně Openprovider (moderní REST/OpenAPI, 2 000+ TLD). V `server.js` nahraďte odpověď endpointu `POST /api/order` voláním registrátora až po potvrzené platbě. Ceny v UI jsou pouze orientační a musí se před nasazením napojit na živý ceník partnera.

Pro produkci je dále nutné doplnit platební bránu, trvalé úložiště objednávek a číselnou řadu účetních dokladů, autentizaci klientů, obchodní podmínky/GDPR, potvrzení aktuálních pravidel registrace, retry/idempotenci objednávek a monitoring expirací. Na Vercelu se současný `data/orders.jsonl` zapisuje do dočasného `/tmp` a není trvalou účetní evidencí; zálohová faktura v e-mailu sama o sobě neprokazuje platbu ani registraci domény.
