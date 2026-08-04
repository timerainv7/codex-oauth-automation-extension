const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadMessageRouterModule() {
  const source = fs.readFileSync('background/message-router.js', 'utf8');
  return new Function('self', `${source}; return self.MultiPageBackgroundMessageRouter;`)({ console });
}

function extractFunction(source, name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start === undefined || start < 0) throw new Error(`missing function ${name}`);

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === '(') parenDepth += 1;
    if (character === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) signatureEnded = true;
    }
    if (character === '{' && signatureEnded) {
      braceStart = index;
      break;
    }
  }

  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function loadCpamReauthControllerModule() {
  const source = fs.readFileSync('background/cpam-reauth-controller.js', 'utf8');
  return new Function('self', `${source}; return self.MultiPageBackgroundCpamReauthController;`)({});
}

test('CPAM API failures redact the configured access token from router diagnostics and error responses', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  const api = new Function(`
${extractFunction(source, 'redactCpamErrorMessage')}
${extractFunction(source, 'reportMessageRouterError')}
return { reportMessageRouterError };
`)();
  const token = 'cpam-secret-token';
  const errors = [];
  let response = null;

  api.reportMessageRouterError(
    new Error(`CPAM request rejected Authorization: Bearer ${token}`),
    (value) => { response = value; },
    token,
    { error: (...args) => errors.push(args) }
  );

  assert.equal(JSON.stringify(errors).includes(token), false);
  assert.equal(JSON.stringify(response).includes(token), false);
  assert.match(response.error, /\[REDACTED\]/);

  let genericResponse = null;
  api.reportMessageRouterError(
    new Error('ordinary network error'),
    (value) => { genericResponse = value; },
    token,
    { error: () => {} }
  );
  assert.equal(genericResponse.error, 'ordinary network error');
});

test('CPAM API failures redact the configured access token from reauth runtime state and broadcasts', async () => {
  const token = 'cpam-secret-token';
  const patches = [];
  const broadcasts = [];
  const controller = loadCpamReauthControllerModule().createCpamReauthController({
    getState: async () => ({
      targetId: 'cpa',
      accountDeliveryMode: 'oauth',
      customPassword: 'password',
      cpamAccessToken: token,
    }),
    getRunCandidates: async () => {
      throw new Error(`CPAM request rejected Authorization: Bearer ${token}`);
    },
    setState: async (patch) => patches.push(patch),
    broadcastDataUpdate: (patch) => broadcasts.push(patch),
    clearStopRequest: () => {},
  });

  await assert.rejects(() => controller.start(), /CPAM request rejected/);

  assert.equal(JSON.stringify(patches).includes(token), false);
  assert.equal(JSON.stringify(broadcasts).includes(token), false);
  assert.match(patches.at(-1).reauthRuntime.error, /\[REDACTED\]/);
  assert.match(broadcasts.at(-1).reauthRuntime.error, /\[REDACTED\]/);
});

test('CPAM token rotation cannot leak a previous run token through a rethrown API error', async () => {
  const source = fs.readFileSync('background.js', 'utf8');
  const reporter = new Function(`
${extractFunction(source, 'redactCpamErrorMessage')}
${extractFunction(source, 'reportMessageRouterError')}
return reportMessageRouterError;
`)();
  const oldToken = 'old-cpam-secret';
  const newToken = 'new-cpam-secret';
  let currentToken = oldToken;
  const patches = [];
  const broadcasts = [];
  const controller = loadCpamReauthControllerModule().createCpamReauthController({
    getState: async () => ({
      targetId: 'cpa',
      accountDeliveryMode: 'oauth',
      customPassword: 'password',
      cpamAccessToken: currentToken,
    }),
    getRunCandidates: async () => {
      currentToken = newToken;
      const error = new Error(`CPAM rejected Bearer ${oldToken}`);
      error.name = 'CpamApiError';
      error.code = 'CPAM_REJECTED';
      throw error;
    },
    setState: async (patch) => patches.push(patch),
    broadcastDataUpdate: (patch) => broadcasts.push(patch),
    clearStopRequest: () => {},
  });

  let thrownError = null;
  try {
    await controller.start();
  } catch (error) {
    thrownError = error;
  }

  const consoleErrors = [];
  let routerResponse = null;
  reporter(thrownError, (response) => { routerResponse = response; }, currentToken, {
    error: (...args) => consoleErrors.push(args),
  });

  assert.ok(thrownError instanceof Error);
  assert.equal(thrownError.name, 'CpamApiError');
  assert.equal(thrownError.code, 'CPAM_REJECTED');
  assert.equal(thrownError.message.includes(oldToken), false);
  assert.equal(JSON.stringify(routerResponse).includes(oldToken), false);
  assert.equal(JSON.stringify(consoleErrors).includes(oldToken), false);
  assert.equal(JSON.stringify(patches).includes(oldToken), false);
  assert.equal(JSON.stringify(broadcasts).includes(oldToken), false);
  assert.match(routerResponse.error, /\[REDACTED\]/);
});

test('background-equivalent CPAM controller wiring reaches node execution when no stop is requested', async () => {
  const source = fs.readFileSync('background.js', 'utf8');
  const getStopRequested = new Function(
    'stopRequested',
    `${extractFunction(source, 'getStopRequested')}; return getStopRequested;`
  )(false);
  const executedNodeIds = [];
  const controller = loadCpamReauthControllerModule().createCpamReauthController({
    getRunCandidates: async () => ({
      candidates: [{ email: 'reauth@example.test', fileName: 'reauth.json', authIndex: 'a' }],
      skipped: [],
    }),
    getState: async () => ({
      targetId: 'cpa',
      accountDeliveryMode: 'oauth',
      customPassword: 'password',
    }),
    setState: async () => {},
    broadcastDataUpdate: () => {},
    clearOpenAiCookies: async () => {},
    clearStopRequest: () => {},
    getStopRequested,
    executeNode: async (nodeId) => executedNodeIds.push(nodeId),
  });

  const summary = await controller.start();

  assert.equal(summary.succeeded, 1);
  assert.deepEqual(executedNodeIds, [
    'oauth-login',
    'fetch-login-code',
    'post-login-phone-verification',
    'confirm-oauth',
    'platform-verify',
  ]);
  assert.match(source, /getStopRequested,\s*addLog,\s*getRunCandidates:/);
});

test('background CPAM inspection wiring creates one API instance and delegates candidate requests', async () => {
  const source = fs.readFileSync('background.js', 'utf8');
  const createCandidateLoader = new Function(
    `${extractFunction(source, 'createCpamInspectionCandidateLoader')}; return createCpamInspectionCandidateLoader;`
  )();
  const settings = { cpamBaseUrl: 'https://cpam.example.test', cpamInspectionRunId: '47' };
  const expected = { run: { id: 47 }, candidates: [{ email: 'reauth@example.test' }], skipped: [] };
  const calls = [];
  const getRunCandidates = createCandidateLoader({
    createCpamInspectionApi: () => {
      calls.push({ type: 'factory' });
      return {
        getRunCandidates: async (receivedSettings) => {
          calls.push({ type: 'getRunCandidates', receivedSettings });
          return expected;
        },
      };
    },
  });

  assert.deepEqual(await getRunCandidates(settings), expected);
  assert.deepEqual(calls, [
    { type: 'factory' },
    { type: 'getRunCandidates', receivedSettings: settings },
  ]);

  const missingFactoryLoader = createCandidateLoader({});
  await assert.rejects(
    () => missingFactoryLoader(settings),
    /CPAM inspection capability is not available\./
  );
});

test('generic persistent settings normalize CPAM values for saving', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  const normalizedRunIds = [];
  const api = new Function('self', `
const PERSISTED_SETTING_DEFAULTS = {
  cpamBaseUrl: '',
  cpamAccessToken: '',
  cpamInspectionRunId: '',
  cpamReauthReplaceOriginalFile: true,
};
const PERSISTED_SETTING_KEYS = Object.keys(PERSISTED_SETTING_DEFAULTS);
function getSettingsSchemaApi() { return null; }
function getSettingsSchemaLegacyMigrationStorageKeys() { return []; }
function resolveLegacyAutoStepDelaySeconds() { return undefined; }
function isPlainObjectValue(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
${extractFunction(source, 'normalizePersistentSettingValue')}
${extractFunction(source, 'buildPersistentSettingsPayload')}
return { buildPersistentSettingsPayload };
`)({
    MultiPageBackgroundCpamInspectionApi: {
      normalizeBaseUrl: (value) => `normalized:${value.trim()}`,
      normalizeRunId: (value) => {
        normalizedRunIds.push(value);
        return `run:${value.trim()}`;
      },
    },
  });

  assert.deepEqual(api.buildPersistentSettingsPayload({
    cpamBaseUrl: ' https://cpam.example.test/ ',
    cpamAccessToken: ' token ',
    cpamInspectionRunId: ' 42 ',
  }), {
    cpamBaseUrl: 'normalized:https://cpam.example.test/',
    cpamAccessToken: 'token',
    cpamInspectionRunId: 'run:42',
  });
  assert.deepEqual(normalizedRunIds, ['42']);

  assert.deepEqual(api.buildPersistentSettingsPayload({ cpamInspectionRunId: '' }), {
    cpamInspectionRunId: '',
  });
  assert.deepEqual(api.buildPersistentSettingsPayload({ cpamInspectionRunId: '   ' }), {
    cpamInspectionRunId: '',
  });
  assert.deepEqual(normalizedRunIds, ['42']);
  assert.deepEqual(api.buildPersistentSettingsPayload({ cpamReauthReplaceOriginalFile: false }), {
    cpamReauthReplaceOriginalFile: false,
  });
});

test('setState diagnostics redact CPAM access tokens before logging updates', async () => {
  const source = fs.readFileSync('background.js', 'utf8');
  const logs = [];
  const sessionWrites = [];
  const setState = new Function(
    'console',
    'LOG_PREFIX',
    'redactCpamAccessTokens',
    'chrome',
    'DEFAULT_STATE',
    'buildStatePatchWithRuntimeState',
    'normalizeBooleanMap',
    'normalizeIcloudAliasCacheList',
    `${extractFunction(source, 'setState')}; return setState;`
  )(
    { log: (...args) => logs.push(args) },
    '[test]',
    (value) => ({ ...value, cpamAccessToken: value.cpamAccessToken ? '[REDACTED]' : value.cpamAccessToken }),
    {
      storage: {
        session: {
          get: async () => ({}),
          set: async (value) => sessionWrites.push(value),
        },
        local: { set: async () => {} },
      },
    },
    {},
    (_state, updates) => updates,
    (value) => value,
    (value) => value
  );

  await setState({ cpamAccessToken: 'secret-token' });

  assert.equal(JSON.stringify(logs).includes('secret-token'), false);
  assert.equal(JSON.stringify(logs).includes('[REDACTED]'), true);
  assert.deepEqual(sessionWrites, [{ cpamAccessToken: 'secret-token' }]);
});

test('background redacts CPAM access tokens from message diagnostics', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  const redactCpamAccessTokens = new Function(
    `${extractFunction(source, 'redactCpamAccessTokens')}; return redactCpamAccessTokens;`
  )();

  assert.deepEqual(redactCpamAccessTokens({
    cpamAccessToken: 'secret-token',
    settings: { cpamAccessToken: 'nested-secret' },
    list: [{ cpamAccessToken: 'array-secret' }],
  }), {
    cpamAccessToken: '[REDACTED]',
    settings: { cpamAccessToken: '[REDACTED]' },
    list: [{ cpamAccessToken: '[REDACTED]' }],
  });
});

test('START_CPAM_REAUTH locks the sidepanel automation window before starting CPAM re-auth', async () => {
  const events = [];
  const router = loadMessageRouterModule().createMessageRouter({
    setState: async (patch) => events.push({ type: 'setState', patch }),
    startCpamReauth: async () => {
      events.push({ type: 'start' });
      return { queued: 2, succeeded: 2 };
    },
  });

  const response = await router.handleMessage({
    type: 'START_CPAM_REAUTH',
    source: 'sidepanel',
    payload: { automationWindowId: 42 },
  });

  assert.deepEqual(response, { queued: 2, succeeded: 2 });
  assert.deepEqual(events, [
    { type: 'setState', patch: { automationWindowId: 42 } },
    { type: 'start' },
  ]);
});

test('STOP_CPAM_REAUTH delegates to the CPAM re-auth controller without locking a window', async () => {
  const events = [];
  const router = loadMessageRouterModule().createMessageRouter({
    setState: async (patch) => events.push({ type: 'setState', patch }),
    stopCpamReauth: async () => {
      events.push({ type: 'stop' });
      return { queued: 2, succeeded: 1, failed: 0 };
    },
  });

  const response = await router.handleMessage({
    type: 'STOP_CPAM_REAUTH',
    source: 'sidepanel',
    payload: { automationWindowId: 42 },
  });

  assert.deepEqual(response, { queued: 2, succeeded: 1, failed: 0 });
  assert.deepEqual(events, [{ type: 'stop' }]);
});

test('background wires CPAM modules, settings normalizers, runtime state, and router controller dependencies', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  const routerIndex = source.indexOf("'background/message-router.js'");
  const inspectionIndex = source.indexOf("'background/cpam-inspection-api.js'");
  const controllerIndex = source.indexOf("'background/cpam-reauth-controller.js'");

  assert.ok(inspectionIndex >= 0 && inspectionIndex < routerIndex);
  assert.ok(controllerIndex >= 0 && controllerIndex < routerIndex);
  assert.match(source, /cpamBaseUrl:\s*'',/);
  assert.match(source, /cpamAccessToken:\s*'',/);
  assert.match(source, /cpamInspectionRunId:\s*'',/);
  assert.match(source, /cpamReauthReplaceOriginalFile:\s*true,/);
  assert.match(source, /case 'cpamBaseUrl':[\s\S]*?normalizeBaseUrl/);
  assert.match(source, /case 'cpamAccessToken':[\s\S]*?String\(value \|\| ''\)\.trim\(\)/);
  assert.match(source, /case 'cpamInspectionRunId':[\s\S]*?normalizeRunId/);
  assert.match(source, /case 'cpamReauthReplaceOriginalFile':[\s\S]*?Boolean\(value\)/);
  assert.match(source, /reauthRuntime:\s*\{[\s\S]*?phase:\s*'idle'/);
  assert.match(source, /const cpamReauthController = self\.MultiPageBackgroundCpamReauthController\?\.createCpamReauthController\?\.\(\{/);
  assert.match(source, /listAuthFiles:/);
  assert.match(source, /downloadAuthFile:/);
  assert.match(source, /overwriteAuthFile:/);
  assert.match(source, /deleteAuthFile:/);
  assert.match(source, /startCpamReauth:\s*\(\) => cpamReauthController\?\.start\?\.\(\)/);
  assert.match(source, /stopCpamReauth:\s*\(\) => cpamReauthController\?\.stop\?\.\(\)/);
});
