const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { customerEmail, createInvoicePdf } = require('./order-documents');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.VERCEL ? '/tmp/praut-domeny' : path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.jsonl');
const ALLOWED_TLDS = new Set(['cz', 'com', 'eu', 'sk', 'net', 'org', 'io', 'ai', 'online', 'shop']);
const PRICES = { cz: 299, com: 349, eu: 249, sk: 299, net: 399, org: 399, io: 1299, ai: 2199, online: 699, shop: 899 };
const HOSTING_PRICE = 1500;
const PAYMENT_DUE_DAYS = Math.min(60, Math.max(1, Number.parseInt(process.env.PAYMENT_DUE_DAYS || '14', 10) || 14));

function calculateTotals(domains, hostingDomains = []) {
  const hosted = new Set(hostingDomains.filter(domain => domains.includes(domain)));
  const subtotal = domains.reduce((sum, domain) => sum + (PRICES[domain.split('.').pop()] || 0), 0) + HOSTING_PRICE * hosted.size;
  return { subtotal, total: subtotal, currency: 'CZK' };
}

function clean(value, max = 120) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validateOrder(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.domains) || input.domains.length < 1 || input.domains.length > 20 || !input.customer || typeof input.customer !== 'object') {
    throw new Error('Doplňte domény a fakturační údaje.');
  }
  if (input.domains.some(value => typeof value !== 'string')) throw new Error('Neplatná doména.');
  const domains = [...new Set(input.domains.map(normalizeDomain))];
  if (domains.some(domain => !validDomain(domain) || !ALLOWED_TLDS.has(domain.split('.').pop()))) throw new Error('Objednávka obsahuje neplatnou nebo nepodporovanou doménu.');
  const rawHosting = Array.isArray(input.hostingDomains) ? input.hostingDomains : [];
  if (rawHosting.length > 20 || rawHosting.some(value => typeof value !== 'string')) throw new Error('Neplatný výběr hostingu.');
  const hostingDomains = [...new Set(rawHosting.map(normalizeDomain))];
  if (hostingDomains.some(domain => !domains.includes(domain))) throw new Error('Hosting musí patřit k objednané doméně.');
  const customer = {
    email: clean(input.customer.email, 254), name: clean(input.customer.name), street: clean(input.customer.street),
    city: clean(input.customer.city), postalCode: clean(input.customer.postalCode, 16),
    country: clean(input.customer.country || 'Česká republika', 80), companyId: clean(input.customer.companyId, 24)
  };
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(customer.email) || !customer.name || !customer.street || !customer.city || !/^[\p{L}\d][\p{L}\d\s-]{2,15}$/u.test(customer.postalCode) || !customer.country) {
    throw new Error('Doplňte platný e-mail a úplnou fakturační adresu.');
  }
  if (Object.values(customer).some(value => /[\r\n\u0000-\u001f]/.test(value))) throw new Error('Fakturační údaje obsahují nepovolené znaky.');
  const now = new Date();
  const due = new Date(now.getTime() + PAYMENT_DUE_DAYS * 86400000);
  return {
    reference: `PRAUT-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    variableSymbol: String(crypto.randomInt(1_000_000_000, 10_000_000_000)),
    createdAt: now.toISOString(), dueAt: due.toISOString(), domains, customer, hostingDomains,
    prices: PRICES, hostingPrice: HOSTING_PRICE, status: 'awaiting_payment',
    totals: calculateTotals(domains, hostingDomains)
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function normalizeDomain(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
}

function validDomain(domain) {
  if (domain.length > 253 || !domain.includes('.')) return false;
  return domain.split('.').every(label => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label));
}

async function checkDomain(domain) {
  const tld = domain.split('.').pop();
  if (!ALLOWED_TLDS.has(tld)) return { domain, status: 'unsupported' };
  const base = tld === 'cz' ? 'https://rdap.nic.cz/domain/' : 'https://rdap.org/domain/';
  try {
    const response = await fetch(base + encodeURIComponent(domain), {
      headers: { 'Accept': 'application/rdap+json, application/json', 'User-Agent': 'PRAUT-Domeny/1.0' },
      signal: AbortSignal.timeout(8000)
    });
    if (response.status === 404) return { domain, status: 'available' };
    if (response.ok) return { domain, status: 'taken' };
    return { domain, status: 'unknown' };
  } catch {
    return { domain, status: 'unknown' };
  }
}

async function notifyOwner(order) {
  const subject = `Nová objednávka domény: ${order.domains.join(', ')}`;
  const text = [
    'Na domeny.praut.cz vznikla nová objednávka.',
    '',
    `Domény: ${order.domains.join(', ')}`,
    `Jméno / firma: ${order.customer.name || 'neuvedeno'}`,
    `E-mail: ${order.customer.email}`,
    `Hosting: ${order.hostingDomains.length ? order.hostingDomains.join(', ') : 'ne'}`,
    `Celkem: ${order.totals.total.toFixed(2)} Kč (nejsme plátci DPH)`,
    `Reference: ${order.reference}`,
    `Čas: ${order.createdAt}`
  ].join('\n');
  const deliveries = [];

  if (process.env.RESEND_API_KEY) {
    let invoice;
    try { invoice = await createInvoicePdf(order); }
    catch (error) { console.error(`[${order.reference}] PDF selhalo:`, error.message); }
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.NOTIFY_FROM || 'PRAUT Domény <domeny@praut.cz>',
          to: [process.env.NOTIFY_EMAIL || 'objednavky@praut.cz'],
          reply_to: order.customer.email,
          subject,
          text,
          ...(invoice ? { attachments: [{ filename: `zaloha-${order.reference}.pdf`, content: invoice.toString('base64'), content_type: 'application/pdf' }] } : {})
        }),
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error(`E-mailová služba odpověděla ${response.status}: ${await response.text()}`);
      deliveries.push('email');
    } catch (error) { console.error(`[${order.reference}] E-mail selhal:`, error.message); }

    try {
      if (!invoice) throw new Error('PDF není dostupné');
      const message = customerEmail(order);
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.NOTIFY_FROM || 'PRAUT Domény <domeny@praut.cz>',
          to: [order.customer.email], reply_to: process.env.NOTIFY_EMAIL || 'objednavky@praut.cz',
          subject: message.subject, html: message.html, text: message.text,
          attachments: [{ filename: `zaloha-${order.reference}.pdf`, content: invoice.toString('base64'), content_type: 'application/pdf' }]
        }),
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error(`E-mailová služba odpověděla ${response.status}: ${await response.text()}`);
      deliveries.push('customer-email');
    } catch (error) { console.error(`[${order.reference}] Potvrzení zákazníkovi selhalo:`, error.message); }
  }

  if (process.env.ORDER_WEBHOOK_URL) {
    const isDiscord = /(?:discord(?:app)?\.com|discordapp\.net)\/api\/webhooks\//i.test(process.env.ORDER_WEBHOOK_URL);
    const domain = order.domains[0];
    const tld = domain.split('.').pop();
    const mentionIds = String(process.env.DISCORD_MENTION_IDS || '').split(',').map(id => id.trim()).filter(id => /^\d{15,22}$/.test(id));
    const mentions = mentionIds.length ? mentionIds.map(id => `<@${id}>`).join(' ') : '@emperor_kundis @tartistbees @stpzz';
    const registryUrl = tld === 'cz' ? `https://www.nic.cz/whois/?d=${encodeURIComponent(domain)}` : `https://lookup.icann.org/en/lookup?name=${encodeURIComponent(domain)}`;
    const webhookBody = isDiscord ? {
      username: 'PRAUT Domény',
      content: `🛒 **Nová objednávka domény**\n${mentions}`,
      allowed_mentions: { parse: [], users: mentionIds },
      embeds: [{
        title: `🌐 ${order.domains.join(', ')}`,
        url: registryUrl,
        description: 'Klient odeslal zájem o registraci. Před nákupem znovu ověřte dostupnost a následně klientovi potvrďte přijetí.',
        color: 0x283487,
        fields: [
          { name: 'Zákazník', value: order.customer.name || 'Neuvedeno', inline: true },
          { name: 'E-mail', value: order.customer.email, inline: true },
          { name: 'Položky', value: order.domains.map(name => `• ${name} — ${PRICES[name.split('.').pop()] || '?'} Kč${order.hostingDomains.includes(name) ? `\n  ↳ hosting na 1 rok — ${HOSTING_PRICE} Kč` : ''}`).join('\n'), inline: false },
          { name: 'Celkem', value: `**${order.totals.total.toFixed(2).replace('.', ',')} Kč**\nNejsme plátci DPH`, inline: true },
          { name: 'Reference', value: `\`${order.reference}\``, inline: true },
          { name: 'Rychlé odkazy', value: `[Ověřit v registru](${registryUrl}) · [Koupit u VEDOS](https://vedos.cz/domeny/)`, inline: false },
          { name: 'Doporučený postup', value: '1. Ověřit dostupnost\n2. Kontaktovat klienta\n3. Nakoupit až po potvrzení/platbě\n4. Zapsat doménu na údaje klienta', inline: false }
        ],
        timestamp: order.createdAt,
        footer: { text: 'domeny.praut.cz' }
      }]
    } : { text: `🛒 ${subject}\n${text}`, order };
    try {
      const response = await fetch(process.env.ORDER_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookBody),
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error(`Webhook odpověděl ${response.status}: ${await response.text()}`);
      deliveries.push('webhook');
    } catch (error) { console.error(`[${order.reference}] Webhook selhal:`, error.message); }
  }
  return deliveries;
}

function contentType(file) {
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream';
}

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/invoice-preview' && req.method === 'GET') {
    const sample = validateOrder({
      domains: ['ukazkova-domena.cz'], hostingDomains: ['ukazkova-domena.cz'],
      customer: { email: 'ukazka@example.test', name: 'Jana Nováková', street: 'Ukázková 12', city: 'Brno', postalCode: '602 00', country: 'Česká republika' }
    });
    sample.reference = 'PRAUT-UKAZKA-001';
    sample.variableSymbol = '1234567890';
    sample.sample = true;
    try {
      const pdf = await createInvoicePdf(sample);
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="praut-ukazka.pdf"', 'Cache-Control': 'no-store' });
      return res.end(pdf);
    } catch (error) {
      console.error('Ukázka PDF selhala:', error.message);
      return sendJson(res, 500, { error: 'Ukázku PDF nyní nelze připravit.' });
    }
  }
  if (url.pathname === '/api/availability' && req.method === 'GET') {
    const domain = normalizeDomain(url.searchParams.get('domain'));
    if (!validDomain(domain)) return sendJson(res, 400, { error: 'Zadejte platnou doménu, například moje-firma.cz.' });
    return sendJson(res, 200, await checkDomain(domain));
  }

  if (url.pathname === '/api/order' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (body.length > 30_000) return sendJson(res, 413, { error: 'Objednávka je příliš velká.' });
    let order;
    try { order = JSON.parse(body); } catch { return sendJson(res, 400, { error: 'Neplatná objednávka.' }); }
    let savedOrder;
    try { savedOrder = validateOrder(order); }
    catch (error) { return sendJson(res, 400, { error: error.message }); }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(ORDERS_FILE, JSON.stringify(savedOrder) + '\n', { mode: 0o600 });

    let deliveries = [];
    try { deliveries = await notifyOwner(savedOrder); } catch (error) { console.error(`[${savedOrder.reference}] Notifikace selhala:`, error.message); }
    return sendJson(res, 202, {
      status: 'received',
      reference: savedOrder.reference,
      totals: savedOrder.totals,
      notified: deliveries,
      message: deliveries.includes('customer-email')
        ? 'Objednávku jsme přijali. Výzvu k platbě jsme odeslali na váš e-mail.'
        : 'Objednávku jsme přijali. Výzvu k platbě zatím nelze odeslat; ozveme se vám s dalším postupem.'
    });
  }

  let relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, relative);
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    relative = 'index.html';
  }
  const resolved = path.resolve(PUBLIC_DIR, relative);
  res.writeHead(200, { 'Content-Type': contentType(resolved), 'Cache-Control': resolved.endsWith('.html') ? 'no-cache' : 'public, max-age=86400' });
  fs.createReadStream(resolved).pipe(res);
}

const server = http.createServer(handler);

if (require.main === module) server.listen(PORT, () => console.log(`PRAUT Domény: http://localhost:${PORT}`));
module.exports = { normalizeDomain, validDomain, calculateTotals, validateOrder, checkDomain, notifyOwner, handler, server };
