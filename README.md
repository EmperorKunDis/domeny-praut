# PRAUT Domény

Prototyp klientského vyhledávání a objednávání domén pro `domeny.praut.cz`. Používá veřejné RDAP CZ.NIC pro `.cz` a RDAP bootstrap pro podporované zahraniční TLD. Skutečná registrace je záměrně vypnutá, dokud nebude připojen účet registrátora a platební brána.

## Spuštění

```bash
npm start
```

Web poběží na `http://localhost:3000`. Projekt nemá žádné runtime závislosti, vyžaduje Node.js 20+.

## Upozornění na novou objednávku

Každá objednávka se vždy uloží do `data/orders.jsonl`. Pro okamžitý e-mail nastavte na serveru:

```bash
RESEND_API_KEY=re_xxx
NOTIFY_EMAIL=objednavky@praut.cz
NOTIFY_FROM="PRAUT Domény <domeny@praut.cz>"
```

Volitelně lze nastavit `ORDER_WEBHOOK_URL` na příchozí webhook Slacku, Teams, Discordu nebo scénáře v Make. Lze zapnout e-mail i webhook současně. Doména odesílatele musí být u e-mailové služby ověřená.

## Produkční integrace

Doporučená cesta pro PRAUT je reseller účet Subreg/Gransy (česká podpora, `.cz`, 900+ TLD, SOAP/EPP, white-label), případně Openprovider (moderní REST/OpenAPI, 2 000+ TLD). V `server.js` nahraďte odpověď endpointu `POST /api/order` voláním registrátora až po potvrzené platbě. Ceny v UI jsou pouze orientační a musí se před nasazením napojit na živý ceník partnera.

Pro produkci je dále nutné doplnit platební bránu, trvalé úložiště objednávek, autentizaci klientů, obchodní podmínky/GDPR, potvrzení aktuálních pravidel registrace, fakturaci, retry/idempotenci objednávek a monitoring expirací.
