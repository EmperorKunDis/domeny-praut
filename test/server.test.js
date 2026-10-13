const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDomain, validDomain, calculateTotals, validateOrder, notifyOwner, server } = require('../server');
const { customerEmail, createInvoicePdf } = require('../order-documents');

const input = () => ({
  domains: ['firma.cz', 'firma.com'], hostingDomains: ['firma.cz'],
  customer: { email: 'jana@example.test', name: 'Jana Nováková', street: 'Dlouhá 4', city: 'Praha', postalCode: '110 00', country: 'Česká republika' }
});

test('normalizes a pasted URL', () => assert.equal(normalizeDomain(' HTTPS://www.Moje-Firma.cz/cesta '), 'moje-firma.cz'));
test('accepts valid domain names', () => assert.equal(validDomain('moje-firma.cz'), true));
test('rejects malformed domain names', () => {
  assert.equal(validDomain('-spatne.cz'), false);
  assert.equal(validDomain('bez-koncovky'), false);
});
test('charges hosting separately for every domain without VAT', () => {
  assert.deepEqual(calculateTotals(['firma.cz', 'firma.com'], ['firma.cz', 'firma.com']), { subtotal: 3648, total: 3648, currency: 'CZK' });
});
test('allows hosting for only one selected domain', () => {
  assert.deepEqual(calculateTotals(['firma.cz', 'firma.com'], ['firma.com']), { subtotal: 2148, total: 2148, currency: 'CZK' });
});

test('validates billing data, allowed domains and order item ownership', () => {
  const order = validateOrder(input());
  assert.equal(order.totals.total, 2148);
  assert.match(order.reference, /^PRAUT-\d{8}-[A-F0-9]{8}$/);
  assert.match(order.variableSymbol, /^\d{10}$/);
  assert.throws(() => validateOrder({ ...input(), domains: ['firma.invalid'] }), /nepodporovanou/);
  assert.throws(() => validateOrder({ ...input(), hostingDomains: ['cizi.cz'] }), /Hosting/);
  assert.throws(() => validateOrder({ ...input(), customer: { ...input().customer, street: '' } }), /fakturační/);
});

test('escapes customer input in HTML and includes payment details', () => {
  const order = validateOrder({ ...input(), customer: { ...input().customer, name: '<script>alert(1)</script>' } });
  const message = customerEmail(order);
  assert.ok(message.html.includes('&lt;script&gt;'));
  assert.ok(!message.html.includes('<script>'));
  assert.ok(message.html.includes('6720177389/0800'));
  assert.ok(message.html.includes('Nejsme plátci DPH'));
  assert.ok(message.text.includes('2 148,00 Kč'));
});

test('Resend receives customer email with PDF attachment', async () => {
  const order = validateOrder(input());
  const pdf = await createInvoicePdf(order);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 5000);
  const priorFetch = global.fetch;
  const priorKey = process.env.RESEND_API_KEY;
  const priorWebhook = process.env.ORDER_WEBHOOK_URL;
  const sent = [];
  process.env.RESEND_API_KEY = 'test-only';
  delete process.env.ORDER_WEBHOOK_URL;
  global.fetch = async (url, request) => {
    assert.equal(url, 'https://api.resend.com/emails');
    sent.push(JSON.parse(request.body));
    return { ok: true };
  };
  try {
    assert.deepEqual(await notifyOwner(order), ['email', 'customer-email']);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].attachments[0].content_type, 'application/pdf');
    assert.deepEqual(sent[1].to, ['jana@example.test']);
    assert.equal(sent[1].attachments[0].content_type, 'application/pdf');
    assert.equal(Buffer.from(sent[1].attachments[0].content, 'base64').subarray(0, 5).toString(), '%PDF-');
  } finally {
    global.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = priorKey;
    if (priorWebhook === undefined) delete process.env.ORDER_WEBHOOK_URL; else process.env.ORDER_WEBHOOK_URL = priorWebhook;
  }
});

test('invoice preview renders without PDFKit bundled Helvetica or sending mail', async () => {
  const Module = require('node:module');
  const originalLoad = Module._load;
  Module._load = function(request, ...args) {
    if (request.startsWith('#standard-fonts/')) throw new Error('standard fonts unavailable');
    return originalLoad.call(this, request, ...args);
  };
  try {
    const order = validateOrder(input());
    const pdf = await createInvoicePdf({ ...order, sample: true });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  } finally { Module._load = originalLoad; }
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/invoice-preview`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/pdf/);
    assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
