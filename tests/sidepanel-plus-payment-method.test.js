const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sidepanelSource = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');
const sidepanelHtml = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');

function extractFunction(name) {
  const start = sidepanelSource.indexOf(`function ${name}`);
  if (start === -1) {
    throw new Error(`Function ${name} not found`);
  }
  const signatureEnd = sidepanelSource.indexOf(')', start);
  const bodyStart = sidepanelSource.indexOf('{', signatureEnd);
  let depth = 0;
  let end = bodyStart;
  for (; end < sidepanelSource.length; end += 1) {
    const char = sidepanelSource[end];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }
  return sidepanelSource.slice(start, end);
}

test('sidepanel defaults dormant Plus payment method to PayPal', () => {
  assert.match(sidepanelSource, /const DEFAULT_PLUS_PAYMENT_METHOD = PLUS_PAYMENT_METHOD_PAYPAL;/);
  assert.match(sidepanelSource, /currentPlusPaymentMethod = DEFAULT_PLUS_PAYMENT_METHOD/);
  assert.match(sidepanelHtml, /<option value="paypal" selected>PayPal<\/option>/);
});

test('sidepanel accepts only supported dormant Plus payment methods', () => {
  const normalizePlusPaymentMethod = new Function(`
    const PLUS_PAYMENT_METHOD_PAYPAL = 'paypal';
    const PLUS_PAYMENT_METHOD_PAYPAL_HOSTED = 'paypal-hosted';
    const PLUS_PAYMENT_METHOD_NONE = 'none';
    ${extractFunction('normalizePlusPaymentMethod')}
    return normalizePlusPaymentMethod;
  `)();

  assert.equal(normalizePlusPaymentMethod('paypal'), 'paypal');
  assert.equal(normalizePlusPaymentMethod('paypal-hosted'), 'paypal-hosted');
  assert.equal(normalizePlusPaymentMethod('none'), 'none');
  assert.equal(normalizePlusPaymentMethod('gopay'), 'paypal');
  assert.equal(normalizePlusPaymentMethod('paypal-direct'), 'paypal');
});

test('sidepanel keeps Plus controls hidden and disabled', () => {
  assert.match(sidepanelHtml, /id="row-plus-mode" style="display:none;"/);
  assert.match(sidepanelHtml, /id="input-plus-mode-enabled" disabled/);
  assert.match(extractFunction('updatePlusModeUI'), /rowPlusMode\.style\.display = 'none'/);
  assert.match(extractFunction('updatePlusModeUI'), /inputPlusModeEnabled\.checked = false/);
  assert.match(extractFunction('updatePlusModeUI'), /inputPlusModeEnabled\.disabled = true/);
});

test('sidepanel always saves Plus as disabled', () => {
  assert.match(extractFunction('collectSettingsPayload'), /plusModeEnabled:\s*false/);
});
