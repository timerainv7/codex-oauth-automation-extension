const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { readFlowRegistryBundle, readStepDefinitionsBundle } = require('./helpers/script-bundles.js');

const flowRegistrySource = readFlowRegistryBundle();
const stepDefinitionsSource = readStepDefinitionsBundle();
const settingsSchemaSource = fs.readFileSync('core/flow-kernel/settings-schema.js', 'utf8');
const messageRouterSource = fs.readFileSync('background/message-router.js', 'utf8');

function loadSettingsSchema() {
  const scope = {};
  const api = new Function(
    'self',
    `${flowRegistrySource}; ${settingsSchemaSource}; return self.MultiPageSettingsSchema;`
  )(scope);
  return api.createSettingsSchema();
}

function loadStepDefinitions() {
  const scope = {};
  return new Function(
    'self',
    `${stepDefinitionsSource}; return self.MultiPageStepDefinitions;`
  )(scope);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

test('schema v6 migrates delivery mode by canonical priority and removes legacy strategy fields', () => {
  const schema = loadSettingsSchema();
  const normalized = schema.normalizeSettingsState({
    settingsState: {
      schemaVersion: 5,
      activeFlowId: 'openai',
      flows: {
        openai: {
          selectedTargetId: 'sub2api',
          targets: {
            sub2api: { accountDeliveryMode: 'session' },
          },
          plus: {
            plusModeEnabled: true,
            sub2apiImportMode: 'agent_identity',
            plusAccountAccessStrategy: 'cpa_codex_session',
          },
        },
      },
    },
  });

  assert.equal(normalized.schemaVersion, 6);
  assert.equal(normalized.flows.openai.targets.sub2api.accountDeliveryMode, 'session');
  assert.equal(normalized.flows.openai.plus.plusModeEnabled, false);
  assert.equal(normalized.flows.openai.plus.plusPaymentMethod, 'paypal');
  assert.equal(hasOwn(normalized.flows.openai.plus, 'sub2apiImportMode'), false);
  assert.equal(hasOwn(normalized.flows.openai.plus, 'plusAccountAccessStrategy'), false);

  const view = schema.buildSettingsView(normalized);
  assert.equal(view.settingsSchemaVersion, 6);
  assert.equal(view.accountDeliveryMode, 'session');
  assert.equal(hasOwn(view, 'plusAccountAccessStrategy'), false);
  assert.equal(hasOwn(view, 'sub2apiImportMode'), false);
});

test('schema v6 falls back from agent import mode and legacy strategy to target defaults', () => {
  const schema = loadSettingsSchema();
  const fromAgentImportMode = schema.normalizeSettingsState({
    settingsState: {
      activeFlowId: 'openai',
      flows: {
        openai: {
          selectedTargetId: 'sub2api',
          plus: { sub2apiImportMode: 'agent_identity' },
        },
      },
    },
  });
  assert.equal(fromAgentImportMode.flows.openai.targets.sub2api.accountDeliveryMode, 'agent_identity');

  const fromLegacyStrategy = schema.normalizeSettingsState({
    settingsState: {
      activeFlowId: 'openai',
      flows: {
        openai: {
          selectedTargetId: 'cpa',
          plus: { plusAccountAccessStrategy: 'cpa_codex_session' },
        },
      },
    },
  });
  assert.equal(fromLegacyStrategy.flows.openai.targets.cpa.accountDeliveryMode, 'session');

  const fromInvalidValues = schema.normalizeSettingsState({
    settingsState: {
      activeFlowId: 'openai',
      flows: {
        openai: {
          selectedTargetId: 'sub2api',
          targets: { sub2api: { accountDeliveryMode: 'not-a-mode' } },
          plus: {
            sub2apiImportMode: 'invalid',
            plusAccountAccessStrategy: 'invalid',
          },
        },
      },
    },
  });
  assert.equal(fromInvalidValues.flows.openai.targets.sub2api.accountDeliveryMode, 'oauth');
  assert.deepEqual(
    schema.getLegacyMigrationStorageKeys().sort(),
    [
      'plusAccountAccessStrategy',
      'sub2apiImportMode',
    ].sort()
  );
});

test('schema v6 removes retired delivery fields from every canonical and derived location', () => {
  const schema = loadSettingsSchema();
  const normalized = schema.normalizeSettingsState({
    plusAccountAccessStrategy: 'sub2api_codex_session',
    sub2apiImportMode: 'agent_identity',
    settingsState: {
      activeFlowId: 'openai',
      flows: {
        openai: {
          selectedTargetId: 'sub2api',
          plusAccountAccessStrategy: 'sub2api_codex_session',
          sub2apiImportMode: 'agent_identity',
          targets: {
            sub2api: {
              plusAccountAccessStrategy: 'sub2api_codex_session',
              sub2apiImportMode: 'agent_identity',
            },
          },
          plus: {
            plusAccountAccessStrategy: 'sub2api_codex_session',
            sub2apiImportMode: 'agent_identity',
          },
        },
      },
    },
  });

  const openAi = normalized.flows.openai;
  assert.equal(openAi.targets.sub2api.accountDeliveryMode, 'agent_identity');
  assert.equal(hasOwn(openAi, 'plusAccountAccessStrategy'), false);
  assert.equal(hasOwn(openAi, 'sub2apiImportMode'), false);
  assert.equal(hasOwn(openAi.targets.sub2api, 'plusAccountAccessStrategy'), false);
  assert.equal(hasOwn(openAi.targets.sub2api, 'sub2apiImportMode'), false);
  assert.equal(hasOwn(openAi.plus, 'plusAccountAccessStrategy'), false);
  assert.equal(hasOwn(openAi.plus, 'sub2apiImportMode'), false);

  const view = schema.buildSettingsView(normalized, {
    plusAccountAccessStrategy: 'sub2api_codex_session',
    sub2apiImportMode: 'agent_identity',
  });
  assert.equal(hasOwn(view, 'plusAccountAccessStrategy'), false);
  assert.equal(hasOwn(view, 'sub2apiImportMode'), false);
});

test('workflow exposes only composable delivery routes with contiguous nodes', () => {
  const api = loadStepDefinitions();
  assert.equal(typeof api.getVariantStepDefinitions, 'undefined');

  const cases = [
    {
      targetId: 'cpa',
      accountDeliveryMode: 'session',
      tail: 'cpa-session-import',
    },
    {
      targetId: 'sub2api',
      accountDeliveryMode: 'agent_identity',
      tail: 'sub2api-agent-identity-import',
    },
    {
      targetId: 'codex2api',
      accountDeliveryMode: 'oauth',
      tail: 'platform-verify',
    },
  ];

  for (const testCase of cases) {
    const steps = api.getSteps({
      activeFlowId: 'openai',
      targetId: testCase.targetId,
      accountDeliveryMode: testCase.accountDeliveryMode,
      plusModeEnabled: false,
    });
    assert.ok(steps.length > 0, `${testCase.targetId} should have steps`);
    assert.deepEqual(
      steps.map((step) => step.id),
      steps.map((_, index) => index + 1),
      `${testCase.targetId} ids should be contiguous`
    );
    assert.equal(steps.at(-1)?.key, testCase.tail);
    assert.equal(steps.some((step) => /^plus(?:Paypal|Hosted)/.test(step.key || '')), false);
  }
});

test('workflow composes payment between registration and account delivery without cross-product variants', () => {
  const api = loadStepDefinitions();
  const steps = api.getSteps({
    activeFlowId: 'openai',
    targetId: 'sub2api',
    accountDeliveryMode: 'agent_identity',
    plusModeEnabled: true,
    plusPaymentMethod: 'paypal-hosted',
  });
  const keys = steps.map((step) => step.key);
  assert.deepEqual(keys.slice(-1), ['sub2api-agent-identity-import']);
  assert.ok(keys.indexOf('paypal-hosted-review') > keys.indexOf('fill-profile'));
  assert.ok(keys.indexOf('sub2api-agent-identity-import') > keys.indexOf('paypal-hosted-review'));
  assert.equal(keys.some((key) => String(key).includes('plusPaypal')), false);
});

test('background wires Agent Identity route and resolves delivery from capability fields only', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /flows\/openai\/background\/agent-identity\.js/);
  assert.match(source, /flows\/openai\/background\/steps\/sub2api-agent-identity-import\.js/);
  assert.match(source, /sub2api-agent-identity-import/);
  assert.match(source, /const sub2ApiAgentIdentityImportExecutor = self\.MultiPageBackgroundSub2ApiAgentIdentityImport\?\.createSub2ApiAgentIdentityImportExecutor\(/);
  assert.match(source, /'sub2api-agent-identity-import': \(state\) => sub2ApiAgentIdentityImportExecutor\.executeSub2ApiAgentIdentityImport\(state\)/);
  assert.match(source, /AUTO_RUN_BACKGROUND_COMPLETED_STEP_KEYS[\s\S]*'sub2api-agent-identity-import'/);
  assert.match(source, /AUTO_RUN_NODE_DELAYS[\s\S]*'sub2api-agent-identity-import': 0/);
  assert.match(source, /accountDeliveryRouteId/);
  assert.doesNotMatch(source, /getStepDefinitionsForState\([\s\S]*plusAccountAccessStrategy/);
  assert.doesNotMatch(source, /const PLUS_ACCOUNT_ACCESS_STRATEGY_(?:OAUTH|SUB2API_CODEX_SESSION|CPA_CODEX_SESSION)/);
});

function createLockedSettingsRouter(state, calls) {
  const scope = {};
  const api = new Function(
    'self',
    `${messageRouterSource}; return self.MultiPageBackgroundMessageRouter;`
  )(scope);
  return api.createMessageRouter({
    buildPersistentSettingsPayload: (payload) => ({ ...payload }),
    buildLuckmailSessionSettingsPayload: () => ({}),
    getState: async () => state,
    isAutoRunLockedState: () => true,
    setPersistentSettings: async (updates) => {
      calls.push(updates);
      return updates;
    },
  });
}

test('message router rejects target or delivery changes while a workflow is locked', async () => {
  const calls = [];
  const router = createLockedSettingsRouter({
    activeFlowId: 'openai',
    targetId: 'cpa',
    accountDeliveryMode: 'oauth',
    autoRunning: true,
    nodeStatuses: {},
  }, calls);

  await assert.rejects(
    router.handleMessage({
      type: 'SAVE_SETTING',
      payload: { targetId: 'sub2api', accountDeliveryMode: 'agent_identity' },
    }, {}),
    (error) => error?.code === 'ACCOUNT_DELIVERY_SELECTION_LOCKED'
  );
  assert.deepEqual(calls, []);
});

test('message router requires an explicit target for delivery mode saves', async () => {
  const scope = {};
  const api = new Function(
    'self',
    `${messageRouterSource}; return self.MultiPageBackgroundMessageRouter;`
  )(scope);
  const router = api.createMessageRouter({
    buildPersistentSettingsPayload: (payload) => ({ ...payload }),
    buildLuckmailSessionSettingsPayload: () => ({}),
    getState: async () => ({
      activeFlowId: 'openai',
      targetId: 'cpa',
      accountDeliveryMode: 'oauth',
      nodeStatuses: {},
    }),
    isAutoRunLockedState: () => false,
  });

  await assert.rejects(
    router.handleMessage({
      type: 'SAVE_SETTING',
      payload: { accountDeliveryMode: 'session' },
    }, {}),
    (error) => error?.code === 'ACCOUNT_DELIVERY_TARGET_REQUIRED'
  );
});
