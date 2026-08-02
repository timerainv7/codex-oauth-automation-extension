const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readStepDefinitionsBundle } = require('./helpers/script-bundles.js');

const RUNTIME_FILES = [
  'background.js',
  'background/auto-run-controller.js',
  'background/logging-status.js',
  'background/message-router.js',
  'core/flow-kernel/logging-status.js',
  'core/flow-kernel/runtime-state.js',
  'core/flow-kernel/settings-schema.js',
  'flows/openai/background/steps/create-plus-checkout.js',
  'flows/openai/background/steps/fill-plus-checkout.js',
  'flows/openai/index.js',
  'flows/openai/workflow.js',
  'sidepanel/i18n-static.js',
  'sidepanel/sidepanel.css',
  'sidepanel/sidepanel.html',
  'sidepanel/sidepanel.js',
];

function readRuntimeSource() {
  return RUNTIME_FILES
    .map((file) => `${file}\n${fs.readFileSync(file, 'utf8')}`)
    .join('\n');
}

test('runtime source no longer contains retired GPC and Plus Auto channels', () => {
  const source = readRuntimeSource();
  const retiredPatterns = [
    /gpc-helper/i,
    /plus-auto/i,
    /GpcUtils/,
    /REFRESH_GPC_CARD_BALANCE/,
    /gpc\.qlhazycoder\.top/i,
    /auto\.1iiu\.com/i,
    /gpc(?:BaseUrl|CardKey|Balance|RemainingUses|CardStatus|PageStatus)/,
    /auto(?:Cdk|TimeoutSeconds|OrderId|JobId|OrderState|PaymentStatus)/,
  ];

  retiredPatterns.forEach((pattern) => {
    assert.doesNotMatch(source, pattern);
  });
  assert.equal(fs.existsSync(path.resolve('gpc-utils.js')), false);
});

test('OpenAI workflow no longer exports retired GPC and Plus Auto variants', () => {
  const scope = {};
  const api = new Function('self', `${readStepDefinitionsBundle()}; return self.MultiPageOpenAiWorkflow;`)(scope);

  assert.equal(api.getVariantStepDefinitions, undefined);
  assert.equal(typeof api.getModeStepDefinitions, 'function');

  const steps = api.getModeStepDefinitions({
    targetId: 'sub2api',
    accountDeliveryMode: 'agent_identity',
    plusModeEnabled: false,
  });
  assert.equal(steps.at(-1)?.key, 'sub2api-agent-identity-import');
  assert.equal(steps.some((step) => step.key.startsWith('plus-')), false);
});

test('sidepanel keeps dormant PayPal settings but removes retired channel controls', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');

  assert.match(html, /id="row-plus-mode"/);
  assert.match(html, /option value="paypal"/);
  assert.match(html, /option value="paypal-hosted"/);
  assert.match(html, /option value="none"/);
  assert.doesNotMatch(html, /id="row-gpc-card-key"/);
  assert.doesNotMatch(html, /id="row-auto-cdk"/);
  assert.doesNotMatch(html, /id="btn-gpc-card-key-purchase"/);
  assert.doesNotMatch(html, /id="btn-auto-cdk-purchase"/);
  assert.doesNotMatch(html, /gpc-utils\.js/);
});
