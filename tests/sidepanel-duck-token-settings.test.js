const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
const source = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

test('sidepanel exposes only Duck DDG token controls', () => {
  assert.doesNotMatch(html, /id="row-duck-email-generation-mode"/);
  assert.doesNotMatch(html, /id="select-duck-email-generation-mode"/);
  assert.doesNotMatch(html, /option value="page">打开页面<\/option>/);
  assert.doesNotMatch(html, /option value="token">Token 直连<\/option>/);
  assert.match(html, /id="row-duck-ddg-token"/);
  assert.match(html, /id="input-duck-ddg-token"/);
});

test('sidepanel persists and forwards Duck DDG token settings', () => {
  assert.doesNotMatch(source, /rowDuckEmailGenerationMode/);
  assert.doesNotMatch(source, /selectDuckEmailGenerationMode/);
  assert.doesNotMatch(source, /duckEmailGenerationMode/);
  assert.doesNotMatch(source, /normalizeDuckEmailGenerationMode/);
  assert.doesNotMatch(source, /getSelectedDuckEmailGenerationMode/);
  assert.match(source, /const rowDuckDdgToken = document\.getElementById\('row-duck-ddg-token'\)/);
  assert.match(source, /const inputDuckDdgToken = document\.getElementById\('input-duck-ddg-token'\)/);
  assert.match(source, /duckDdgToken: typeof inputDuckDdgToken/);
  assert.match(source, /inputDuckDdgToken\.value = String\(state\?\.duckDdgToken \|\| ''\)\.trim\(\)/);
  assert.match(source, /const showDuckDdgToken = useEmailGenerator && selectedGenerator === 'duck'/);
  assert.match(source, /inputDuckDdgToken\?\.addEventListener\('input'/);
  assert.match(source, /message\.payload\.duckDdgToken !== undefined/);
});
