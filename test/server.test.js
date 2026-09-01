const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDomain, validDomain } = require('../server');

test('normalizes a pasted URL', () => assert.equal(normalizeDomain(' HTTPS://www.Moje-Firma.cz/cesta '), 'moje-firma.cz'));
test('accepts valid domain names', () => assert.equal(validDomain('moje-firma.cz'), true));
test('rejects malformed domain names', () => {
  assert.equal(validDomain('-spatne.cz'), false);
  assert.equal(validDomain('bez-koncovky'), false);
});
