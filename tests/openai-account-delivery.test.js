const test = require('node:test');
const assert = require('node:assert/strict');
const { readFlowRegistryBundle } = require('./helpers/script-bundles.js');

function loadApis() {
  const scope = {};
  const flowRegistrySource = readFlowRegistryBundle();
  return new Function('self', `${flowRegistrySource}; return {
    accountDelivery: self.MultiPageOpenAiAccountDelivery,
    flowRegistry: self.MultiPageFlowRegistry,
  };`)(scope);
}

test('OpenAI account delivery registry exposes the three canonical modes', () => {
  const { accountDelivery } = loadApis();

  assert.ok(accountDelivery);
  assert.equal(accountDelivery.ACCOUNT_DELIVERY_MODE_OAUTH, 'oauth');
  assert.equal(accountDelivery.ACCOUNT_DELIVERY_MODE_SESSION, 'session');
  assert.equal(accountDelivery.ACCOUNT_DELIVERY_MODE_AGENT_IDENTITY, 'agent_identity');
  assert.deepEqual(
    accountDelivery.getAccountDeliveryModeOptions().map((entry) => entry.id),
    ['oauth', 'session', 'agent_identity']
  );
  assert.equal(accountDelivery.getAccountDeliveryModeDefinition('session').label, 'ChatGPT Session');
  assert.equal(accountDelivery.normalizeAccountDeliveryMode('AGENT_IDENTITY'), 'agent_identity');
  assert.equal(accountDelivery.normalizeAccountDeliveryMode('unknown', 'session'), 'session');
  assert.equal(accountDelivery.normalizeAccountDeliveryMode('unknown', 'invalid'), 'oauth');
});

test('OpenAI target capability matrix declares defaults and routes for every supported delivery mode', () => {
  const { flowRegistry } = loadApis();
  const expectedMatrix = {
    cpa: {
      modes: ['oauth', 'session'],
      defaultMode: 'oauth',
      routes: { oauth: 'oauth', session: 'cpa-session' },
    },
    sub2api: {
      modes: ['oauth', 'session', 'agent_identity'],
      defaultMode: 'oauth',
      routes: {
        oauth: 'oauth',
        session: 'sub2api-session',
        agent_identity: 'sub2api-agent-identity',
      },
    },
    codex2api: {
      modes: ['oauth'],
      defaultMode: 'oauth',
      routes: { oauth: 'oauth' },
    },
    webchat: {
      modes: ['session'],
      defaultMode: 'session',
      routes: { session: 'webchat-session' },
    },
    chatgpt2api: {
      modes: ['session'],
      defaultMode: 'session',
      routes: { session: 'chatgpt2api-session' },
    },
  };

  Object.entries(expectedMatrix).forEach(([targetId, expected]) => {
    const capability = flowRegistry.getTargetCapabilities('openai', targetId);
    assert.deepEqual(capability.supportedAccountDeliveryModes, expected.modes, targetId);
    assert.equal(capability.defaultAccountDeliveryMode, expected.defaultMode, targetId);
    assert.ok(capability.supportedAccountDeliveryModes.includes(capability.defaultAccountDeliveryMode), targetId);
    assert.deepEqual(capability.accountDeliveryRouteByMode, expected.routes, targetId);
    capability.supportedAccountDeliveryModes.forEach((mode) => {
      assert.ok(capability.accountDeliveryRouteByMode[mode], `${targetId}:${mode}`);
    });
  });
});

test('OpenAI exposes account delivery as an independent settings group', () => {
  const { flowRegistry } = loadApis();
  const flow = flowRegistry.getFlowDefinition('openai');

  assert.ok(flow.baseGroups.includes('openai-account-delivery'));
  assert.deepEqual(
    flow.settingsGroups['openai-account-delivery'].rowIds,
    ['row-account-delivery-mode']
  );
  assert.doesNotMatch(
    JSON.stringify(flow.settingsGroups['openai-plus']),
    /account-delivery|account-access/
  );
});
