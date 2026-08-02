const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('registration-only sidepanel excludes contribution and advertising entry points', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
  assert.doesNotMatch(html, /id="btn-contribution-mode"/);
  assert.doesNotMatch(html, /id="auto-run-ad-bar"/);
  assert.doesNotMatch(html, /id="contribution-update-layer"/);
  assert.doesNotMatch(html, /contribution-content-update-service\.js/);
  assert.doesNotMatch(html, /contribution-mode\.js/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
});

test('sidepanel source no longer keeps the legacy upload-page handler on the header contribution button', () => {
  const source = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

  assert.doesNotMatch(source, /openContributionUploadPage/);
  assert.doesNotMatch(source, /await openContributionUploadPage\(\)/);
});
