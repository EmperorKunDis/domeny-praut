const PDFDocument = require('pdfkit');
const path = require('node:path');

const BANK = Object.freeze({ account: '6720177389/0800', iban: 'CZ38 0800 0000 0067 2017 7389', bic: 'GIBACZPX' });
const SUPPLIER = Object.freeze({ name: 'PRAUT s.r.o.', id: '22545107', address: 'Obrněné brigády 552/33, 350 02 Cheb' });
const FONT_REGULAR = path.join(__dirname, 'assets/fonts/Montserrat-Regular.ttf');
const FONT_BOLD = path.join(__dirname, 'assets/fonts/Montserrat-Bold.ttf');
const formatMoney = value => new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' Kč';
const formatDate = iso => new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function lineItems(order) {
  return order.domains.flatMap(domain => [
    { label: `Registrace domény ${domain} na 1 rok`, amount: order.prices[domain.split('.').pop()] },
    ...(order.hostingDomains.includes(domain) ? [{ label: `Hosting pro ${domain} na 1 rok`, amount: order.hostingPrice }] : [])
  ]);
}

function customerText(customer) {
  return [customer.name, customer.street, `${customer.postalCode} ${customer.city}`, customer.country, customer.companyId ? `IČO: ${customer.companyId}` : ''].filter(Boolean).join('\n');
}

function customerEmail(order) {
  const items = lineItems(order);
  const rows = items.map(item => `<tr><td style="padding:12px 0;border-bottom:1px solid #e2e5f3;color:#181E4E;font-size:14px">${escapeHtml(item.label)}</td><td align="right" style="padding:12px 0;border-bottom:1px solid #e2e5f3;color:#0a0e2e;font-size:14px;font-weight:700;white-space:nowrap">${escapeHtml(formatMoney(item.amount))}</td></tr>`).join('');
  const name = escapeHtml(order.customer.name);
  const ref = escapeHtml(order.reference);
  const due = escapeHtml(formatDate(order.dueAt));
  const address = customerText(order.customer).split('\n').map(escapeHtml).join('<br>');
  const sample = order.sample ? '<div style="background:#fff1cb;color:#624400;padding:10px 18px;text-align:center;font-weight:700">UKÁZKA - NEPLATNÝ DOKLAD, NEPLAŤTE</div>' : '';
  const html = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#FAF5FF;font-family:Arial,Helvetica,sans-serif;color:#181E4E"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#FAF5FF"><tr><td align="center" style="padding:28px 12px"><table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background:#fff;border-radius:18px;overflow:hidden"><tr><td style="padding:30px 36px;background:#0a0e2e;color:#fff"><div style="font-size:28px;font-weight:800;letter-spacing:-1px">PRAUT<span style="color:#b47aff">.</span></div><div style="margin-top:14px;color:#d8d1ff;font-size:12px;letter-spacing:2px">DOMÉNY &amp; HOSTING</div></td></tr><tr><td>${sample}</td></tr><tr><td style="padding:32px 36px"><div style="font-size:12px;font-weight:700;letter-spacing:2px;color:#8D2AF3">OBJEDNÁVKA PŘIJATA</div><h1 style="font-size:26px;line-height:1.2;color:#0a0e2e;margin:12px 0 16px">Vaše doména je o krok blíž.</h1><p style="font-size:15px;line-height:1.7;margin:0 0 20px">Dobrý den, ${name},<br>děkujeme za objednávku. V příloze najdete zálohovou fakturu / výzvu k platbě. Po přijetí platby znovu ověříme dostupnost a ozveme se s dalším postupem. Doména zatím není registrovaná.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF5FF;border-radius:12px"><tr><td style="padding:14px 18px;font-size:13px;color:#626584">Číslo objednávky<br><strong style="color:#0a0e2e">${ref}</strong></td><td style="padding:14px 18px;font-size:13px;color:#626584">Splatnost<br><strong style="color:#0a0e2e">${due}</strong></td></tr></table><h2 style="font-size:17px;color:#0a0e2e;margin:28px 0 5px">Přehled objednávky</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}<tr><td style="padding:18px 0;font-size:16px;font-weight:700;color:#0a0e2e">Celkem k úhradě</td><td align="right" style="padding:18px 0;font-size:18px;font-weight:700;color:#8D2AF3;white-space:nowrap">${escapeHtml(formatMoney(order.totals.total))}</td></tr></table><div style="background:#eef1ff;border-radius:12px;padding:18px;font-size:14px;line-height:1.8"><strong style="color:#0a0e2e">Platební údaje</strong><br>Účet: <strong>${BANK.account}</strong><br>Variabilní symbol: <strong>${escapeHtml(order.variableSymbol)}</strong><br>IBAN: ${BANK.iban}<br>Splatnost: ${due}</div><p style="font-size:13px;color:#626584;line-height:1.6;margin:22px 0 0">Fakturační údaje: ${address}<br>Nejsme plátci DPH. Máte dotaz? Napište na <a href="mailto:objednavky@praut.cz" style="color:#8D2AF3">objednavky@praut.cz</a>.</p></td></tr><tr><td style="padding:22px 36px;background:#0a0e2e;color:#c5caf5;font-size:12px">PRAUT s.r.o. · IČO ${SUPPLIER.id} · ${SUPPLIER.address}<br><span style="color:#8890bd">domeny.praut.cz</span></td></tr></table></td></tr></table></body></html>`;
  const text = [`${order.sample ? 'UKÁZKA - NEPLATNÝ DOKLAD, NEPLAŤTE\n' : ''}PRAUT Domény - objednávka ${order.reference}`, '', `Dobrý den, ${order.customer.name},`, 'děkujeme za objednávku. Zálohová faktura / výzva k platbě je v příloze.', 'Doména zatím není registrovaná. Po přijetí platby znovu ověříme její dostupnost.', '', ...items.map(item => `${item.label}: ${formatMoney(item.amount)}`), `Celkem k úhradě: ${formatMoney(order.totals.total)}`, `Splatnost: ${formatDate(order.dueAt)}`, `Účet: ${BANK.account}`, `Variabilní symbol: ${order.variableSymbol}`, `IBAN: ${BANK.iban}`, '', `Fakturační údaje:\n${customerText(order.customer)}`, '', `Dodavatel: ${SUPPLIER.name}, IČO ${SUPPLIER.id}, ${SUPPLIER.address}`, 'Nejsme plátci DPH.', 'Dotazy: objednavky@praut.cz'].join('\n');
  return { subject: `PRAUT Domény - objednávka ${order.reference} a zálohová faktura`, html, text };
}

function createInvoicePdf(order) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', font: FONT_REGULAR, margins: { top: 42, bottom: 50, left: 48, right: 48 }, info: { Title: `Zálohová faktura ${order.reference}`, Author: SUPPLIER.name } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('regular', FONT_REGULAR);
    doc.registerFont('bold', FONT_BOLD);
    const W = 595.28, H = 841.89, L = 48, R = 547;
    const page = () => {
      doc.rect(0, 0, W, 112).fill('#0a0e2e');
      doc.font('bold').fontSize(27).fillColor('#ffffff').text('PRAUT.', L, 42);
      doc.font('regular').fontSize(9).fillColor('#c5caf5').text('DOMÉNY & HOSTING', L, 80);
      doc.font('bold').fontSize(10).fillColor('#ffffff').text('ZÁLOHOVÁ FAKTURA', 350, 49, { width: 197, align: 'right' });
      doc.font('regular').fontSize(9).fillColor('#c5caf5').text(order.reference, 350, 68, { width: 197, align: 'right' });
      doc.font('regular').fontSize(8).fillColor('#626584').text(`PRAUT s.r.o. · IČO ${SUPPLIER.id} · Nejsme plátci DPH`, L, H - 73, { width: 499, align: 'center' });
      doc.moveTo(L, H - 84).lineTo(R, H - 84).strokeColor('#e2e5f3').stroke();
    };
    page();
    if (order.sample) {
      doc.save().rotate(-29, { origin: [300, 430] }).font('bold').fontSize(66).fillColor('#ead6fb').opacity(0.55).text('UKÁZKA', 100, 380, { width: 400, align: 'center' }).restore();
    }
    let y = 139;
    doc.font('bold').fontSize(17).fillColor('#0a0e2e').text('Výzva k platbě', L, y);
    y += 31;
    doc.font('regular').fontSize(9).fillColor('#626584').text(`Vystaveno: ${formatDate(order.createdAt)}`, L, y);
    doc.text(`Splatnost: ${formatDate(order.dueAt)}`, 335, y);
    y += 31;
    doc.roundedRect(L, y, 240, 108, 10).fill('#FAF5FF');
    doc.roundedRect(305, y, 242, 108, 10).fill('#eef1ff');
    doc.font('bold').fontSize(9).fillColor('#8D2AF3').text('DODAVATEL', L + 15, y + 14);
    doc.font('bold').fontSize(11).fillColor('#0a0e2e').text(SUPPLIER.name, L + 15, y + 34);
    doc.font('regular').fontSize(8.5).text('Obrněné brigády 552/33\n350 02 Cheb\nIČO 22545107', L + 15, y + 51, { lineGap: 2 });
    doc.font('bold').fontSize(9).fillColor('#3B4EF0').text('ODBĚRATEL', 320, y + 14);
    doc.font('bold').fontSize(10).fillColor('#0a0e2e').text(order.customer.name, 320, y + 32, { width: 208, height: 26, ellipsis: true });
    doc.font('regular').fontSize(8.2).text([order.customer.street, `${order.customer.postalCode} ${order.customer.city}`, order.customer.country, order.customer.companyId ? `IČO ${order.customer.companyId}` : ''].filter(Boolean).join('\n'), 320, y + 59, { width: 208, height: 46, ellipsis: true });
    y += 135;
    const header = () => {
      doc.rect(L, y, 499, 28).fill('#0a0e2e');
      doc.font('bold').fontSize(8.5).fillColor('#ffffff').text('POLOŽKA', L + 12, y + 9).text('CENA', 436, y + 9, { width: 98, align: 'right' });
      y += 28;
    };
    header();
    for (const item of lineItems(order)) {
      if (y > 660) { doc.addPage(); page(); y = 139; header(); }
      const rowHeight = Math.max(33, doc.heightOfString(item.label, { width: 355, font: 'regular', fontSize: 9 }) + 15);
      doc.rect(L, y, 499, rowHeight).fill(y % 2 ? '#ffffff' : '#FAF5FF');
      doc.font('regular').fontSize(9).fillColor('#181E4E').text(item.label, L + 12, y + 10, { width: 355 });
      doc.font('bold').fillColor('#0a0e2e').text(formatMoney(item.amount), 436, y + 10, { width: 98, align: 'right' });
      y += rowHeight;
    }
    if (y > 620) { doc.addPage(); page(); y = 139; }
    y += 13;
    doc.roundedRect(L, y, 499, 51, 10).fill('#FAF5FF');
    doc.font('bold').fontSize(12).fillColor('#0a0e2e').text('Celkem k úhradě', L + 16, y + 17);
    doc.font('bold').fontSize(17).fillColor('#8D2AF3').text(formatMoney(order.totals.total), 325, y + 13, { width: 205, align: 'right' });
    y += 71;
    doc.font('bold').fontSize(10).fillColor('#0a0e2e').text('Platební údaje', L, y);
    y += 23;
    const details = [['Účet', BANK.account], ['Variabilní symbol', order.variableSymbol], ['IBAN', BANK.iban], ['BIC', BANK.bic]];
    for (const [label, value] of details) {
      doc.font('regular').fontSize(8.8).fillColor('#626584').text(label, L, y);
      doc.font('bold').fillColor('#0a0e2e').text(value, 213, y);
      y += 18;
    }
    if (y > 720) { doc.addPage(); page(); y = 139; }
    doc.font('regular').fontSize(8.4).fillColor('#626584').text('Doménu zaregistrujeme až po přijetí platby a opětovném ověření její dostupnosti. Tento doklad není potvrzením registrace ani zaplacení.', L, y + 12, { width: 499, lineGap: 3 });
    doc.end();
  });
}

module.exports = { BANK, SUPPLIER, formatMoney, formatDate, escapeHtml, lineItems, customerEmail, createInvoicePdf };
