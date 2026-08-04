const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('registration-only sidepanel does not load or render an auto-run advertisement', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');

  assert.doesNotMatch(html, /auto-run-ad/);
  assert.doesNotMatch(html, /contribution-content-update-service\.js/);
});
