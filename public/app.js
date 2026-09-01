const prices = { cz: 299, com: 349, eu: 249, sk: 299, net: 399, org: 399, io: 1299, ai: 2199, online: 699, shop: 899 };
const form = document.querySelector('#search-form');
const input = document.querySelector('#domain-input');
const results = document.querySelector('#results');
const cartItems = document.querySelector('#cart-items');
const cartEmpty = document.querySelector('#cart-empty');
const cart = new Map();
const HOSTING_PRICE = 1500;

function normalize(value) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
}

function resultHtml(data) {
  const tld = data.domain.split('.').pop();
  const price = prices[tld];
  const state = data.status === 'available' ? ['available', 'Je volná', 'Přidat'] : data.status === 'taken' ? ['taken', 'Je již obsazená', 'Obsazeno'] : ['', 'Dostupnost se nepodařilo ověřit', 'Zkusit znovu'];
  return `<div class="result ${state[0]}"><span class="dot"></span><div><strong>${data.domain}</strong><small>${state[1]}</small></div>${price ? `<div class="price"><strong>${price} Kč</strong><small>ročně bez DPH</small></div>` : ''}<button type="button" ${data.status !== 'available' ? 'disabled' : ''} data-add="${data.domain}">${state[2]}</button></div>`;
}

async function search(domain) {
  results.innerHTML = '<div class="loader">Ověřuji dostupnost…</div>';
  try {
    const response = await fetch(`/api/availability?domain=${encodeURIComponent(domain)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    results.innerHTML = resultHtml(data);
  } catch (error) {
    results.innerHTML = `<div class="result"><span class="dot"></span><div><strong>Něco se nepovedlo</strong><small>${error.message || 'Zkuste to prosím znovu.'}</small></div></div>`;
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  let domain = normalize(input.value);
  if (!domain.includes('.')) domain += '.cz';
  input.value = domain;
  search(domain);
});

document.querySelectorAll('[data-domain]').forEach(button => button.addEventListener('click', () => { input.value = button.dataset.domain; search(button.dataset.domain); }));
results.addEventListener('click', event => {
  const domain = event.target.dataset.add;
  if (!domain) return;
  cart.set(domain, prices[domain.split('.').pop()] || 0);
  renderCart();
  document.querySelector('#objednavka').scrollIntoView({ behavior: 'smooth' });
});

function renderCart() {
  cartEmpty.hidden = cart.size > 0;
  cartItems.innerHTML = [...cart].map(([domain, price]) => `<div class="cart-item"><span>${domain} · ${price} Kč/rok</span><button type="button" data-remove="${domain}" aria-label="Odebrat ${domain}">Odebrat</button></div>`).join('');
  renderTotal();
}

function money(value) { return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', minimumFractionDigits: 2 }).format(value); }
function renderTotal() {
  const subtotal = [...cart.values()].reduce((sum, price) => sum + price, 0) + (document.querySelector('#hosting').checked ? HOSTING_PRICE * cart.size : 0);
  document.querySelector('#subtotal').textContent = money(subtotal);
  document.querySelector('#vat').textContent = money(subtotal * .21);
  document.querySelector('#grand-total').textContent = money(subtotal * 1.21);
}

document.querySelector('#hosting').addEventListener('change', renderTotal);
renderTotal();

cartItems.addEventListener('click', event => { if (event.target.dataset.remove) { cart.delete(event.target.dataset.remove); renderCart(); } });
document.querySelector('#order-form').addEventListener('submit', async event => {
  event.preventDefault();
  const status = document.querySelector('#order-status');
  if (!cart.size) { status.textContent = 'Nejdříve přidejte alespoň jednu volnou doménu.'; return; }
  const data = new FormData(event.target);
  status.textContent = 'Připravuji objednávku…';
  try {
    const response = await fetch('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domains: [...cart.keys()], hosting: document.querySelector('#hosting').checked, customer: { email: data.get('email'), name: data.get('name') } }) });
    const body = await response.json();
    status.textContent = `${body.message} Číslo: ${body.reference || '—'}`;
  } catch { status.textContent = 'Objednávku se nepodařilo odeslat. Napište nám na info@praut.cz.'; }
});
