const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.VERCEL ? '/tmp/praut-domeny' : path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.jsonl');
const ALLOWED_TLDS = new Set(['cz', 'com', 'eu', 'sk', 'net', 'org', 'io', 'ai', 'online', 'shop']);
const PRICES = { cz: 299, com: 349, eu: 249, sk: 299, net: 399, org: 399, io: 1299, ai: 2199, online: 699, shop: 899 };
const HOSTING_PRICE = 1500;

function calculateTotals(domains, hosting) {
  const subtotal = domains.reduce((sum, domain) => sum + (PRICES[domain.split('.').pop()] || 0), 0) + (hosting ? HOSTING_PRICE * domains.length : 0);
  const vat = Math.round(subtotal * 21) / 100;
  return { subtotal, vat, total: subtotal + vat, currency: 'CZK' };
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
    `Hosting: ${order.hosting ? 'ano' : 'ne'}`,
    `Celkem: ${order.totals.total.toFixed(2)} Kč s DPH`,
    `Reference: ${order.reference}`,
    `Čas: ${order.createdAt}`
  ].join('\n');
  const deliveries = [];

  if (process.env.RESEND_API_KEY) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.NOTIFY_FROM || 'PRAUT Domény <domeny@praut.cz>',
          to: [process.env.NOTIFY_EMAIL || 'objednavky@praut.cz'],
          reply_to: order.customer.email,
          subject,
          text
        }),
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error(`E-mailová služba odpověděla ${response.status}: ${await response.text()}`);
      deliveries.push('email');
    } catch (error) { console.error(`[${order.reference}] E-mail selhal:`, error.message); }
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
          { name: 'Položky', value: `${order.domains.map(name => `• ${name} — ${PRICES[name.split('.').pop()] || '?'} Kč`).join('\n')}${order.hosting ? `\n• Spravovaný hosting ${order.domains.length}× — ${HOSTING_PRICE * order.domains.length} Kč` : ''}`, inline: false },
          { name: 'Celkem', value: `**${order.totals.subtotal.toFixed(2).replace('.', ',')} Kč bez DPH**\n${order.totals.total.toFixed(2).replace('.', ',')} Kč s DPH`, inline: true },
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
    if (!Array.isArray(order.domains) || !order.domains.length || !order.customer?.email) {
      return sendJson(res, 400, { error: 'Doplňte doménu a kontaktní e-mail.' });
    }
    const savedOrder = {
      reference: `PRAUT-${Date.now().toString(36).toUpperCase()}`,
      createdAt: new Date().toISOString(),
      domains: order.domains.map(normalizeDomain).filter(validDomain),
      customer: { email: String(order.customer.email).trim(), name: String(order.customer.name || '').trim() },
      hosting: order.hosting === true,
      status: 'new'
    };
    if (!savedOrder.domains.length) return sendJson(res, 400, { error: 'Objednávka neobsahuje platnou doménu.' });
    savedOrder.totals = calculateTotals(savedOrder.domains, savedOrder.hosting);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(ORDERS_FILE, JSON.stringify(savedOrder) + '\n', { mode: 0o600 });

    let deliveries = [];
    try { deliveries = await notifyOwner(savedOrder); } catch (error) { console.error(`[${savedOrder.reference}] Notifikace selhala:`, error.message); }
    return sendJson(res, 202, {
      status: 'received',
      reference: savedOrder.reference,
      totals: savedOrder.totals,
      notified: deliveries,
      message: 'Děkujeme. Objednávku jsme přijali a ozveme se vám s dalším postupem.'
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
module.exports = { normalizeDomain, validDomain, calculateTotals, checkDomain, notifyOwner, handler, server };
