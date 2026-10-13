const fs = require('node:fs/promises');
const path = require('node:path');
const { validateOrder } = require('../server');
const { customerEmail, createInvoicePdf } = require('../order-documents');

async function main() {
  const order = validateOrder({
    domains: ['ukazkova-domena.cz', 'ukazkovy-projekt.eu'],
    hostingDomains: ['ukazkova-domena.cz'],
    customer: { email: 'jana@example.test', name: 'Jana Nováková', street: 'Ukázková 12', city: 'Brno', postalCode: '602 00', country: 'Česká republika' }
  });
  order.reference = 'PRAUT-UKAZKA-001';
  order.variableSymbol = '1234567890';
  order.sample = true;
  const dir = path.join(__dirname, '..', 'preview');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'order-email.html'), customerEmail(order).html);
  await fs.writeFile(path.join(dir, 'zaloha-ukazka.pdf'), await createInvoicePdf(order));
  console.log(`Ukázky: ${dir}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
