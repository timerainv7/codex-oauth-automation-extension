const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadControllerModule() {
  const source = fs.readFileSync('background/cpam-reauth-controller.js', 'utf8');
  return new Function('self', `${source}; return self.MultiPageBackgroundCpamReauthController;`)({});
}

function createCpamReauthController(deps = {}) {
  return loadControllerModule().createCpamReauthController(deps);
}

function candidate(email, suffix = email) {
  return { email, fileName: `${suffix}.json`, authIndex: suffix, key: `${suffix}.json::${suffix}` };
}

function validState(overrides = {}) {
  return {
    targetId: 'cpa',
    accountDeliveryMode: 'oauth',
    customPassword: 'test-password',
    cpamAccessToken: 'must-not-be-logged',
    ...overrides,
  };
}

function stateHarness(initial = validState()) {
  let state = { ...initial };
  const patches = [];
  return {
    getState: async () => ({ ...state }),
    setState: async (patch) => {
      patches.push(patch);
      state = { ...state, ...patch };
    },
    patches,
    get state() { return state; },
  };
}

function cookieChrome(cookies, removed) {
  return {
    cookies: {
      getAll: async (details) => {
        assert.deepEqual(details, {});
        return cookies;
      },
      remove: async (details) => {
        removed.push(details);
        return {};
      },
    },
  };
}

test('start clears only OpenAI cookies then executes each candidate in CPAM and OAuth-node order', async () => {
  const state = stateHarness();
  const events = [];
  const removed = [];
  const first = candidate('one@example.test', 'one');
  const second = candidate('two@example.test', 'two');
  const controller = createCpamReauthController({
    getRunCandidates: async () => ({ run: { id: 47 }, candidates: [first, second], skipped: [{ position: 9, reason: 'duplicate' }] }),
    ...state,
    broadcastDataUpdate: (patch) => events.push({ type: 'broadcast', patch }),
    executeNode: async (nodeId, payload) => events.push({ type: 'node', nodeId, payload }),
    chrome: cookieChrome([
      { name: 'auth', domain: '.auth.openai.com', path: '/', secure: true },
      { name: 'chat', domain: 'chatgpt.com', path: '/session', secure: false },
      { name: 'cpam', domain: 'cpam.example.test', path: '/', secure: true },
      { name: 'cpa', domain: 'cpa.example.test', path: '/', secure: true },
      { name: 'mail', domain: 'mail.example.test', path: '/', secure: true },
    ], removed),
  });

  const summary = await controller.start();

  assert.deepEqual(summary, { queued: 2, succeeded: 2, failed: 0, skipped: 1, items: controller.getRuntimeState().items });
  assert.deepEqual(removed, [
    { url: 'https://auth.openai.com/', name: 'auth' },
    { url: 'http://chatgpt.com/session', name: 'chat' },
    { url: 'https://auth.openai.com/', name: 'auth' },
    { url: 'http://chatgpt.com/session', name: 'chat' },
  ]);
  assert.deepEqual(events.filter((event) => event.type === 'node').map((event) => `${event.payload.reauthItem.email}:${event.nodeId}`), [
    'one@example.test:oauth-login',
    'one@example.test:fetch-login-code',
    'one@example.test:post-login-phone-verification',
    'one@example.test:confirm-oauth',
    'one@example.test:platform-verify',
    'two@example.test:oauth-login',
    'two@example.test:fetch-login-code',
    'two@example.test:post-login-phone-verification',
    'two@example.test:confirm-oauth',
    'two@example.test:platform-verify',
  ]);
  for (const event of events.filter((entry) => entry.type === 'node')) {
    assert.equal(event.payload.reauthMode, true);
    assert.equal(event.payload.nodeId, event.nodeId);
  }
  assert.deepEqual(state.patches.filter((patch) => patch.email).map((patch) => ({
    email: patch.email,
    accountIdentifierType: patch.accountIdentifierType,
    accountIdentifier: patch.accountIdentifier,
    signupMethod: patch.signupMethod,
    resolvedSignupMethod: patch.resolvedSignupMethod,
    oauthUrl: patch.oauthUrl,
    localhostUrl: patch.localhostUrl,
    cpaOAuthState: patch.cpaOAuthState,
    cpaManagementOrigin: patch.cpaManagementOrigin,
    oauthFlowDeadlineAt: patch.oauthFlowDeadlineAt,
    oauthFlowDeadlineSourceUrl: patch.oauthFlowDeadlineSourceUrl,
  })), [
    {
      email: 'one@example.test', accountIdentifierType: 'email', accountIdentifier: 'one@example.test',
      signupMethod: 'email', resolvedSignupMethod: 'email', oauthUrl: null, localhostUrl: null,
      cpaOAuthState: null, cpaManagementOrigin: null, oauthFlowDeadlineAt: null, oauthFlowDeadlineSourceUrl: null,
    },
    {
      email: 'two@example.test', accountIdentifierType: 'email', accountIdentifier: 'two@example.test',
      signupMethod: 'email', resolvedSignupMethod: 'email', oauthUrl: null, localhostUrl: null,
      cpaOAuthState: null, cpaManagementOrigin: null, oauthFlowDeadlineAt: null, oauthFlowDeadlineSourceUrl: null,
    },
  ]);
  assert.equal(controller.getRuntimeState().phase, 'completed');
  assert.ok(events.filter((event) => event.type === 'broadcast').every((event) => Object.hasOwn(event.patch, 'reauthRuntime')));
});

test('start records a candidate failure and continues with later candidates', async () => {
  const state = stateHarness();
  const calls = [];
  const controller = createCpamReauthController({
    getRunCandidates: async () => ({ candidates: [candidate('bad@example.test', 'bad'), candidate('good@example.test', 'good')], skipped: [] }),
    ...state,
    clearOpenAiCookies: async () => {},
    executeNode: async (nodeId, payload) => {
      calls.push(`${payload.reauthItem.email}:${nodeId}`);
      if (payload.reauthItem.email === 'bad@example.test') throw new Error('login failed');
    },
    broadcastDataUpdate: () => {},
  });

  const summary = await controller.start();

  assert.deepEqual(calls, [
    'bad@example.test:oauth-login',
    'good@example.test:oauth-login',
    'good@example.test:fetch-login-code',
    'good@example.test:post-login-phone-verification',
    'good@example.test:confirm-oauth',
    'good@example.test:platform-verify',
  ]);
  assert.equal(summary.failed, 1);
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.items[0].status, 'failed');
  assert.equal(summary.items[0].step, 'oauth-login');
  assert.match(summary.items[0].error, /login failed/);
  assert.equal(summary.items[1].status, 'succeeded');
});

test('start safely replaces a generated CPA credential with the original 401 file name', async () => {
  const state = stateHarness(validState({ cpamReauthReplaceOriginalFile: true }));
  const calls = [];
  const controller = createCpamReauthController({
    getRunCandidates: async () => ({ candidates: [{ ...candidate('reauth@example.test', 'old'), accountId: 'account-1' }], skipped: [] }),
    ...state,
    clearOpenAiCookies: async () => {},
    executeNode: async () => calls.push('oauth'),
    listAuthFiles: async () => {
      calls.push('list');
      return calls.filter((call) => call === 'list').length === 1
        ? [{ name: 'old.json', email: 'reauth@example.test' }]
        : [{ name: 'old.json', email: 'reauth@example.test' }, { name: 'generated.json', email: 'reauth@example.test' }];
    },
    downloadAuthFile: async (runtimeState, fileName) => {
      calls.push(`download:${fileName}`);
      return { type: 'codex', email: 'reauth@example.test', access_token: 'secret' };
    },
    overwriteAuthFile: async (runtimeState, fileName, credential) => {
      calls.push(`overwrite:${fileName}:${credential.email}`);
    },
    deleteAuthFile: async (runtimeState, fileName) => calls.push(`delete:${fileName}`),
    broadcastDataUpdate: () => {},
  });

  const summary = await controller.start();

  assert.equal(summary.succeeded, 1);
  assert.deepEqual(calls, [
    'list', 'oauth', 'oauth', 'oauth', 'oauth', 'oauth', 'list',
    'download:generated.json', 'overwrite:old.json:reauth@example.test', 'delete:generated.json',
  ]);
  assert.equal(summary.items[0].replacement.status, 'replaced');
  assert.equal(JSON.stringify(summary).includes('secret'), false);
});

test('CPAM ReAuth retries only non-deactivated failures and deletes only deactivated originals', async () => {
  const state = stateHarness();
  const executed = [];
  const deleted = [];
  const controller = createCpamReauthController({
    getRunCandidates: async () => ({ candidates: [candidate('retry@example.test', 'retry'), candidate('gone@example.test', 'gone')], skipped: [] }),
    ...state,
    clearOpenAiCookies: async () => {},
    executeNode: async (nodeId, payload) => {
      executed.push(`${payload.reauthItem.email}:${nodeId}`);
      if (payload.reauthItem.email === 'retry@example.test' && executed.length === 1) throw new Error('temporary network error');
      if (payload.reauthItem.email === 'gone@example.test') throw new Error('ACCOUNT_DEACTIVATED');
    },
    deleteAuthFile: async (runtimeState, fileName) => deleted.push(fileName),
    broadcastDataUpdate: () => {},
  });
  await controller.start();

  const retry = await controller.retryFailed();
  const deletion = await controller.deleteDeactivated();

  assert.equal(retry.succeeded, 1);
  assert.equal(retry.failed, 1);
  assert.equal(retry.items.find((item) => item.email === 'retry@example.test').status, 'succeeded');
  assert.deepEqual(deleted, ['gone.json']);
  assert.equal(deletion.items.find((item) => item.email === 'gone@example.test').deleteStatus, 'deleted');
});

test('start records account deactivation at the node where it appears and continues the queue', async () => {
  const state = stateHarness();
  const controller = createCpamReauthController({
    getRunCandidates: async () => ({ candidates: [candidate('gone@example.test', 'gone'), candidate('ok@example.test', 'ok')], skipped: [] }),
    ...state,
    clearOpenAiCookies: async () => {},
    executeNode: async (nodeId, payload) => {
      if (payload.reauthItem.email === 'gone@example.test' && nodeId === 'fetch-login-code') {
        throw new Error('ACCOUNT_DEACTIVATED::账号已被删除或停用（account_deactivated）');
      }
    },
    broadcastDataUpdate: () => {},
  });

  const summary = await controller.start();

  assert.equal(summary.succeeded, 1);
  assert.equal(summary.failed, 1);
  assert.deepEqual(summary.items[0], {
    ...candidate('gone@example.test', 'gone'),
    status: 'failed',
    error: '账号已被删除或停用（account_deactivated）',
    step: 'fetch-login-code',
  });
});

test('start redacts localhost callback URLs before persisting a candidate failure', async () => {
  const state = stateHarness();
  const controller = createCpamReauthController({
    getRunCandidates: async () => ({ candidates: [candidate('callback@example.test', 'callback')], skipped: [] }),
    ...state,
    clearOpenAiCookies: async () => {},
    executeNode: async () => {
      throw new Error('callback rejected: http://localhost:1455/auth/callback?code=private-code');
    },
    broadcastDataUpdate: () => {},
  });

  const summary = await controller.start();

  assert.equal(summary.items[0].step, 'oauth-login');
  assert.equal(summary.items[0].error.includes('private-code'), false);
  assert.equal(summary.items[0].error.includes('localhost'), false);
});

test('clearOpenAiCookies includes allowed subdomains and excludes CPAM, CPA, mail, and lookalike domains', async () => {
  const removed = [];
  const controller = createCpamReauthController({
    chrome: cookieChrome([
      { name: 'auth', domain: '.auth.openai.com', path: '/', secure: true },
      { name: 'accounts', domain: 'login.accounts.openai.com', path: '/x', secure: false },
      { name: 'chat', domain: '.chat.openai.com', path: '/', secure: true },
      { name: 'gpt', domain: 'www.chatgpt.com', path: '/', secure: true },
      { name: 'cpam', domain: 'cpam.example.test', path: '/', secure: true },
      { name: 'cpa', domain: 'cpa.example.test', path: '/', secure: true },
      { name: 'mail', domain: 'mail.example.test', path: '/', secure: true },
      { name: 'lookalike', domain: 'notchatgpt.com', path: '/', secure: true },
    ], removed),
  });

  assert.equal(await controller.clearOpenAiCookies(), 4);
  assert.deepEqual(removed, [
    { url: 'https://auth.openai.com/', name: 'auth' },
    { url: 'http://login.accounts.openai.com/x', name: 'accounts' },
    { url: 'https://chat.openai.com/', name: 'chat' },
    { url: 'https://www.chatgpt.com/', name: 'gpt' },
  ]);
  assert.equal(await createCpamReauthController({}).clearOpenAiCookies(), 0);
});

test('clearOpenAiCookies preserves cookie store and partition identity and counts only successful removals', async () => {
  const removed = [];
  const controller = createCpamReauthController({
    chrome: {
      cookies: {
        getAll: async () => [{
          name: 'auth', domain: '.auth.openai.com', path: '/session', secure: true,
          storeId: 'store-a', partitionKey: { topLevelSite: 'https://chatgpt.com' },
        }],
        remove: async (details) => {
          removed.push(details);
          return null;
        },
      },
    },
  });

  assert.equal(await controller.clearOpenAiCookies(), 0);
  assert.deepEqual(removed, [{
    url: 'https://auth.openai.com/session',
    name: 'auth',
    storeId: 'store-a',
    partitionKey: { topLevelSite: 'https://chatgpt.com' },
  }]);
});

test('clearOpenAiCookies enumerates stores, deduplicates identities, and removes auth0/openai cookies in their stores', async () => {
  const getAllCalls = [];
  const removed = [];
  const staleAuth0Cookie = { name: 'auth0', domain: '.auth0.openai.com', path: '/', secure: true, storeId: 'store-a' };
  const controller = createCpamReauthController({
    chrome: {
      cookies: {
        getAllCookieStores: async () => [{ id: 'store-a' }, { id: 'store-b' }],
        getAll: async (query) => {
          getAllCalls.push(query);
          if (query.storeId === 'store-a') return [staleAuth0Cookie, { ...staleAuth0Cookie }];
          if (query.storeId === 'store-b') {
            return [{ name: 'openai', domain: '.openai.com', path: '/session', secure: false, storeId: 'store-b' }];
          }
          return [];
        },
        remove: async (details) => {
          removed.push(details);
          return details;
        },
      },
    },
  });

  assert.equal(await controller.clearOpenAiCookies(), 2);
  assert.deepEqual(getAllCalls, [{ storeId: 'store-a' }, { storeId: 'store-b' }]);
  assert.deepEqual(removed, [
    { url: 'https://auth0.openai.com/', name: 'auth0', storeId: 'store-a' },
    { url: 'http://openai.com/session', name: 'openai', storeId: 'store-b' },
  ]);
});

test('clearOpenAiCookies falls back to an unrestricted cookie query when stores cannot be enumerated', async () => {
  const getAllCalls = [];
  const controller = createCpamReauthController({
    chrome: {
      cookies: {
        getAll: async (query) => {
          getAllCalls.push(query);
          return [];
        },
        remove: async () => ({}),
      },
    },
  });

  assert.equal(await controller.clearOpenAiCookies(), 0);
  assert.deepEqual(getAllCalls, [{}]);
});

test('start rejects invalid CPA OAuth settings before fetching candidates', async () => {
  const states = [
    validState({ targetId: 'sub2api' }),
    validState({ accountDeliveryMode: 'session' }),
    validState({ customPassword: '   ', password: '   ' }),
  ];
  for (const invalidState of states) {
    let requested = false;
    const controller = createCpamReauthController({
      getState: async () => invalidState,
      getRunCandidates: async () => { requested = true; return { candidates: [], skipped: [] }; },
    });
    await assert.rejects(() => controller.start());
    assert.equal(requested, false);
  }
});

test('start logs a redacted preflight failure for the activity log', async () => {
  const logs = [];
  const state = stateHarness(validState({ targetId: 'sub2api', cpamAccessToken: 'preflight-secret' }));
  const controller = createCpamReauthController({
    ...state,
    getRunCandidates: async () => ({ candidates: [], skipped: [] }),
    addLog: async (message, level) => logs.push({ message, level }),
  });

  await assert.rejects(() => controller.start(), /CPA target/);

  assert.deepEqual(logs, [{
    message: 'CPAM ReAuth start failed: CPAM ReAuth requires the CPA target.',
    level: 'error',
  }]);
  assert.equal(logs[0].message.includes('preflight-secret'), false);
});

test('start logs a redacted inspection-request failure for the activity log', async () => {
  const logs = [];
  const state = stateHarness(validState({ cpamAccessToken: 'request-secret' }));
  const controller = createCpamReauthController({
    ...state,
    getRunCandidates: async () => {
      throw new Error('CPAM rejected Bearer request-secret');
    },
    addLog: async (message, level) => logs.push({ message, level }),
    broadcastDataUpdate: () => {},
  });

  await assert.rejects(() => controller.start(), /\[REDACTED\]/);

  assert.deepEqual(logs, [{
    message: 'CPAM ReAuth start failed: CPAM rejected Bearer [REDACTED]',
    level: 'error',
  }]);
  assert.equal(logs[0].message.includes('request-secret'), false);
});

test('start rejects a second invocation while the first is still initializing', async () => {
  const stateReady = Promise.withResolvers();
  const controller = createCpamReauthController({
    getState: async () => stateReady.promise,
    getRunCandidates: async () => ({ candidates: [], skipped: [] }),
    setState: async () => {},
    broadcastDataUpdate: () => {},
  });

  const firstStart = controller.start();
  const secondStart = controller.start();
  stateReady.resolve(validState());
  await firstStart;
  await assert.rejects(() => secondStart, /already running/);
});

test('a new run clears an old global stop request without clearing a later stop', async () => {
  const state = stateHarness();
  const firstNodeStarted = Promise.withResolvers();
  const releaseFirstNode = Promise.withResolvers();
  let globalStopRequested = false;
  let firstNode = true;
  const calls = [];
  const controller = createCpamReauthController({
    ...state,
    getRunCandidates: async () => ({ candidates: [candidate('one@example.test', 'one')], skipped: [] }),
    clearOpenAiCookies: async () => {},
    getStopRequested: () => globalStopRequested,
    clearStopRequest: () => { globalStopRequested = false; },
    requestStop: async () => {
      globalStopRequested = true;
      releaseFirstNode.resolve();
    },
    executeNode: async (nodeId) => {
      calls.push(nodeId);
      if (firstNode) {
        firstNode = false;
        firstNodeStarted.resolve();
        await releaseFirstNode.promise;
      }
    },
    broadcastDataUpdate: () => {},
  });

  const firstRun = controller.start();
  await firstNodeStarted.promise;
  await controller.stop();
  await firstRun;
  assert.equal(globalStopRequested, true);

  const secondSummary = await controller.start();
  assert.equal(secondSummary.succeeded, 1);
  assert.deepEqual(calls.slice(1), [
    'oauth-login',
    'fetch-login-code',
    'post-login-phone-verification',
    'confirm-oauth',
    'platform-verify',
  ]);
});

test('stop before delayed state loading finishes skips the CPAM request and reaches a stopped terminal state', async () => {
  const stateReady = Promise.withResolvers();
  let cpamRequests = 0;
  let stopRequests = 0;
  const controller = createCpamReauthController({
    getState: async () => stateReady.promise,
    getRunCandidates: async () => { cpamRequests += 1; return { candidates: [], skipped: [] }; },
    requestStop: () => { stopRequests += 1; },
    setState: async () => {},
    broadcastDataUpdate: () => {},
  });

  const run = controller.start();
  await controller.stop();
  stateReady.resolve(validState());
  const summary = await run;

  assert.equal(stopRequests, 1);
  assert.equal(cpamRequests, 0);
  assert.equal(summary.queued, 0);
  assert.equal(controller.getRuntimeState().phase, 'stopped');
});

test('stop signals requestStop before waiting for a stopping runtime persistence', async () => {
  const state = stateHarness();
  const nodeStarted = Promise.withResolvers();
  const releaseNode = Promise.withResolvers();
  const stoppingPersistence = Promise.withResolvers();
  let stopRequests = 0;
  const controller = createCpamReauthController({
    getRunCandidates: async () => ({ candidates: [candidate('one@example.test', 'one')], skipped: [] }),
    getState: state.getState,
    setState: async (patch) => {
      if (patch.reauthRuntime?.phase === 'stopping') return stoppingPersistence.promise;
      return state.setState(patch);
    },
    clearOpenAiCookies: async () => {},
    executeNode: async () => {
      nodeStarted.resolve();
      await releaseNode.promise;
    },
    requestStop: () => {
      stopRequests += 1;
      releaseNode.resolve();
    },
    broadcastDataUpdate: () => {},
  });

  const run = controller.start();
  await nodeStarted.promise;
  const stopping = controller.stop();
  assert.equal(stopRequests, 1);
  stoppingPersistence.resolve();
  await stopping;
  await run;
});

test('stop during candidate loading prevents candidate execution after loading resolves', async () => {
  const state = stateHarness();
  const candidatesRequested = Promise.withResolvers();
  const candidatesReady = Promise.withResolvers();
  const nodes = [];
  let stopRequests = 0;
  const controller = createCpamReauthController({
    ...state,
    getRunCandidates: async () => {
      candidatesRequested.resolve();
      return candidatesReady.promise;
    },
    clearOpenAiCookies: async () => { throw new Error('cookie cleanup must not start'); },
    executeNode: async (nodeId) => nodes.push(nodeId),
    requestStop: async () => { stopRequests += 1; },
    broadcastDataUpdate: () => {},
  });

  const run = controller.start();
  await candidatesRequested.promise;
  await controller.stop();
  candidatesReady.resolve({ candidates: [candidate('one@example.test', 'one')], skipped: [] });
  const summary = await run;

  assert.equal(stopRequests, 1);
  assert.deepEqual(nodes, []);
  assert.equal(summary.succeeded, 0);
  assert.equal(summary.items[0].status, 'skipped');
  assert.equal(summary.items[0].reason, 'stopped');
  assert.equal(controller.getRuntimeState().phase, 'stopped');
});

test('stop interrupts the active candidate and does not begin the next candidate', async () => {
  const state = stateHarness();
  const firstNodeStarted = Promise.withResolvers();
  const releaseFirstNode = Promise.withResolvers();
  const calls = [];
  let requestedStop = 0;
  const controller = createCpamReauthController({
    getRunCandidates: async () => ({ candidates: [candidate('one@example.test', 'one'), candidate('two@example.test', 'two')], skipped: [] }),
    ...state,
    clearOpenAiCookies: async () => {},
    executeNode: async (nodeId, payload) => {
      calls.push(`${payload.reauthItem.email}:${nodeId}`);
      if (calls.length === 1) {
        firstNodeStarted.resolve();
        await releaseFirstNode.promise;
      }
    },
    requestStop: async () => { requestedStop += 1; releaseFirstNode.resolve(); },
    broadcastDataUpdate: () => {},
  });

  const run = controller.start();
  await firstNodeStarted.promise;
  await controller.stop();
  const summary = await run;

  assert.equal(requestedStop, 1);
  assert.deepEqual(calls, ['one@example.test:oauth-login']);
  assert.equal(summary.succeeded, 0);
  assert.equal(summary.failed, 0);
  assert.equal(summary.items[0].status, 'stopped');
  assert.equal(summary.items[1].status, 'skipped');
  assert.equal(summary.items[1].reason, 'stopped');
  assert.equal(controller.getRuntimeState().phase, 'stopped');
});

test('stop during the final OAuth node does not count the active candidate as successful', async () => {
  const state = stateHarness();
  const finalNodeStarted = Promise.withResolvers();
  const releaseFinalNode = Promise.withResolvers();
  const controller = createCpamReauthController({
    getRunCandidates: async () => ({ candidates: [candidate('one@example.test', 'one')], skipped: [] }),
    ...state,
    clearOpenAiCookies: async () => {},
    executeNode: async (nodeId) => {
      if (nodeId === 'platform-verify') {
        finalNodeStarted.resolve();
        await releaseFinalNode.promise;
      }
    },
    requestStop: async () => releaseFinalNode.resolve(),
    broadcastDataUpdate: () => {},
  });

  const run = controller.start();
  await finalNodeStarted.promise;
  await controller.stop();
  const summary = await run;

  assert.equal(summary.succeeded, 0);
  assert.equal(summary.items[0].status, 'stopped');
  assert.equal(controller.getRuntimeState().phase, 'stopped');
});
