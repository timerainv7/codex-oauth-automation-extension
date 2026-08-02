# CPAM ReAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sequential CPAM-driven ReAuth job that re-runs the existing CPA OAuth delivery flow for every Codex inspection result requiring reauthentication.

**Architecture:** A focused CPAM API module fetches and normalizes one manually selected inspection run. A background ReAuth controller owns the queue, narrowly clears OpenAI cookies, invokes the existing OAuth node chain, and exposes its persisted runtime state through the existing message router. The side panel only collects CPAM settings and renders/controls that job.

**Tech Stack:** Chrome Manifest V3 service worker, `chrome.cookies`, `chrome.storage`, vanilla JavaScript, Node built-in test runner.

---

## File structure

- Create `background/cpam-inspection-api.js`: CPAM URL normalization, authenticated fetch, response validation, and 401 candidate extraction.
- Create `background/cpam-reauth-controller.js`: ReAuth queue lifecycle, OpenAI cookie cleanup, OAuth node execution, stop handling, and summary state.
- Modify `background.js`: load the two modules, persist CPAM settings, construct the controller, and pass its methods into the message router.
- Modify `background/message-router.js`: add the start and stop message cases.
- Modify `sidepanel/sidepanel.html`: add a compact CPAM ReAuth configuration and status card with no external links.
- Create `sidepanel/cpam-reauth.js`: side-panel DOM binding, save/start/stop actions, and render helpers.
- Modify `sidepanel/sidepanel.html` and `sidepanel/sidepanel.js`: load the side-panel module before bootstrap and synchronize persisted values/runtime updates.
- Create `tests/cpam-inspection-api.test.js`, `tests/cpam-reauth-controller.test.js`, and `tests/sidepanel-cpam-reauth.test.js`.

### Task 1: Build the CPAM inspection API module

**Files:**

- Create: `background/cpam-inspection-api.js`
- Test: `tests/cpam-inspection-api.test.js`

- [ ] **Step 1: Write the failing CPAM API tests**

```js
test('getRunCandidates requests the manual run with only the CPAM bearer token', async () => {
  const requests = [];
  const api = createCpamInspectionApi({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({ run: { id: 47 }, results: [] });
    },
  });

  await api.getRunCandidates({
    cpamBaseUrl: 'https://cpam.example.com/',
    cpamAccessToken: 'cpam-token',
    cpamInspectionRunId: '47',
  });

  assert.deepEqual(requests, [{
    url: 'https://cpam.example.com/v0/management/codex-inspection/runs/47',
    options: { method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer cpam-token' } },
  }]);
});

test('getRunCandidates preserves result order and deduplicates codex 401 reauth entries', async () => {
  const api = createCpamInspectionApi({ fetchImpl: async () => jsonResponse({
    run: { id: 47 },
    results: [
      candidate('first@example.com', 'first.json', 'a'),
      { ...candidate('ignore@example.com', 'ignore.json', 'b'), provider: 'xai' },
      { ...candidate('ignore@example.com', 'ignored.json', 'c'), statusCode: 500 },
      candidate('duplicate@example.com', 'first.json', 'a'),
      candidate('second@example.com', 'second.json', 'd'),
    ],
  }) });

  const result = await api.getRunCandidates(validSettings());
  assert.deepEqual(result.candidates.map((item) => item.email), ['first@example.com', 'second@example.com']);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, 'duplicate');
});

test('getRunCandidates rejects a missing run id, token, invalid response, and invalid account email', async () => {
  const api = createCpamInspectionApi({ fetchImpl: async () => jsonResponse({ run: {}, results: 'invalid' }) });
  await assert.rejects(() => api.getRunCandidates({ ...validSettings(), cpamInspectionRunId: '' }), /运行 ID/);
  await assert.rejects(() => api.getRunCandidates({ ...validSettings(), cpamAccessToken: '' }), /访问令牌/);
  await assert.rejects(() => api.getRunCandidates(validSettings()), /results/);
});
```

- [ ] **Step 2: Run the test to verify it fails because the module does not exist**

Run: `node --test tests/cpam-inspection-api.test.js`

Expected: failure loading `../background/cpam-inspection-api.js`.

- [ ] **Step 3: Implement the API module**

```js
function createCpamInspectionApi(deps = {}) {
  const fetchImpl = deps.fetchImpl || ((...args) => fetch(...args));

  function normalizeBaseUrl(value = '') {
    const parsed = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('CPAM 服务地址必须使用 HTTP 或 HTTPS。');
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  }

  function normalizeRunId(value) {
    const runId = String(value || '').trim();
    if (!/^\d+$/.test(runId) || Number(runId) < 1) throw new Error('请填写有效的 CPAM 巡检运行 ID。');
    return runId;
  }

  function toCandidate(item, position) {
    const email = String(item?.displayAccount || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    return {
      key: `${String(item.fileName || '').trim()}::${String(item.authIndex || '').trim()}`,
      fileName: String(item.fileName || '').trim(),
      authIndex: String(item.authIndex || '').trim(),
      email,
      accountId: String(item.accountId || '').trim(),
      position,
    };
  }

  async function getRunCandidates(settings = {}) {
    const token = String(settings.cpamAccessToken || '').trim();
    if (!token) throw new Error('请填写 CPAM 访问令牌。');
    const response = await fetchImpl(`${normalizeBaseUrl(settings.cpamBaseUrl)}/v0/management/codex-inspection/runs/${normalizeRunId(settings.cpamInspectionRunId)}`, {
      method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(String(payload?.message || payload?.error || `CPAM 请求失败（HTTP ${response.status}）`));
    if (!Array.isArray(payload?.results)) throw new Error('CPAM 巡检响应缺少 results 数组。');
    const seen = new Set(); const candidates = []; const skipped = [];
    payload.results.forEach((item, position) => {
      if (item?.provider !== 'codex' || Number(item?.statusCode) !== 401 || item?.action !== 'reauth') return;
      const candidate = toCandidate(item, position);
      if (!candidate) { skipped.push({ position, reason: 'invalid_email' }); return; }
      if (!candidate.fileName || !candidate.authIndex || seen.has(candidate.key)) { skipped.push({ position, reason: 'duplicate' }); return; }
      seen.add(candidate.key); candidates.push(candidate);
    });
    return { run: payload.run || {}, candidates, skipped };
  }
  return { getRunCandidates, normalizeBaseUrl, normalizeRunId };
}
```

Attach the factory as `self.MultiPageBackgroundCpamInspectionApi` and export `createCpamInspectionApi`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/cpam-inspection-api.test.js`

Expected: all CPAM API tests pass.

- [ ] **Step 5: Commit the completed task**

This workspace has no `.git` directory. Record the changed files and test output in the final handoff instead of attempting a commit.

### Task 2: Build the sequential ReAuth controller

**Files:**

- Create: `background/cpam-reauth-controller.js`
- Test: `tests/cpam-reauth-controller.test.js`

- [ ] **Step 1: Write the failing controller tests**

```js
test('runReauth executes candidates in CPAM order after clearing only OpenAI cookies', async () => {
  const events = [];
  const controller = createCpamReauthController({
    getRunCandidates: async () => ({ candidates: [candidate('one@example.com'), candidate('two@example.com')], skipped: [] }),
    clearOpenAiCookies: async () => events.push('cookies'),
    executeOAuthChain: async (item) => events.push(`oauth:${item.email}`),
    getState: async () => validState(), setState: async () => {}, broadcastDataUpdate: () => {},
  });

  await controller.start();
  assert.deepEqual(events, ['cookies', 'oauth:one@example.com', 'cookies', 'oauth:two@example.com']);
});

test('runReauth records one failure and continues with the next candidate', async () => {
  const calls = [];
  const controller = createCpamReauthController({
    getRunCandidates: async () => ({ candidates: [candidate('bad@example.com'), candidate('good@example.com')], skipped: [] }),
    clearOpenAiCookies: async () => {},
    executeOAuthChain: async (item) => {
      calls.push(item.email); if (item.email === 'bad@example.com') throw new Error('login failed');
    },
    getState: async () => validState(), setState: async () => {}, broadcastDataUpdate: () => {},
  });

  const summary = await controller.start();
  assert.deepEqual(calls, ['bad@example.com', 'good@example.com']);
  assert.equal(summary.failed, 1); assert.equal(summary.succeeded, 1);
});

test('clearOpenAiCookies removes auth cookies but never CPAM, CPA, or mail cookies', async () => {
  const removed = [];
  const controller = createCpamReauthController({ chrome: cookieChrome([
    cookie('https://auth.openai.com/', 'a'), cookie('https://cpam.example.com/', 'b'),
    cookie('https://mail.example.com/', 'c'), cookie('https://chatgpt.com/', 'd'),
  ], removed) });
  await controller.clearOpenAiCookies();
  assert.deepEqual(removed.map((item) => item.url), ['https://auth.openai.com/', 'https://chatgpt.com/']);
});
```

- [ ] **Step 2: Run the test to verify it fails because the controller module does not exist**

Run: `node --test tests/cpam-reauth-controller.test.js`

Expected: failure loading `../background/cpam-reauth-controller.js`.

- [ ] **Step 3: Implement controller state and OAuth chain execution**

```js
const REAUTH_NODE_IDS = ['oauth-login', 'fetch-login-code', 'post-login-phone-verification', 'confirm-oauth', 'platform-verify'];
const OPENAI_COOKIE_ORIGINS = ['https://auth.openai.com/', 'https://accounts.openai.com/', 'https://chatgpt.com/', 'https://chat.openai.com/'];

async function executeOAuthChain(item) {
  await setState({
    email: item.email,
    accountIdentifierType: 'email', accountIdentifier: item.email,
    signupMethod: 'email', resolvedSignupMethod: 'email',
    oauthUrl: null, localhostUrl: null, cpaOAuthState: null, cpaManagementOrigin: null,
  });
  for (const nodeId of REAUTH_NODE_IDS) {
    if (stopRequested) throw new Error('REAUTH_STOPPED');
    await executeNode(nodeId, { ...(await getState()), nodeId, reauthItem: item, reauthMode: true });
  }
}
```

Implement `start`, `stop`, `getRuntimeState`, and `clearOpenAiCookies`. `start` must reject concurrent automatic runs, require CPA target + OAuth account delivery mode, require a non-empty current password, set `reauthRuntime.phase` to `running`, and return `{ queued, succeeded, failed, skipped, items }`. `stop` sets only the ReAuth controller stop flag, then calls the existing `requestStop` so an in-flight OAuth node ends safely. Persist `reauthRuntime` only in `chrome.storage.session` through `setState`; do not persist the queue to local settings. Broadcast `{ reauthRuntime }` after every transition.

- [ ] **Step 4: Run the controller tests to verify they pass**

Run: `node --test tests/cpam-reauth-controller.test.js`

Expected: queue ordering, isolation of cookie deletion, failure continuation, and stop tests pass.

- [ ] **Step 5: Commit the completed task**

This workspace has no `.git` directory. Record the changed files and test output in the final handoff instead of attempting a commit.

### Task 3: Integrate settings, runtime, and message routing

**Files:**

- Modify: `background.js`
- Modify: `background/message-router.js`
- Test: `tests/background-cpam-reauth-router.test.js`

- [ ] **Step 1: Write the failing router integration tests**

```js
test('START_CPAM_REAUTH delegates to the controller and returns its summary', async () => {
  const calls = [];
  const router = createMessageRouter({
    startCpamReauth: async () => { calls.push('start'); return { queued: 2 }; },
    getState: async () => ({}), addLog: async () => {},
  });
  assert.deepEqual(await router.handleMessage({ type: 'START_CPAM_REAUTH', source: 'sidepanel', payload: {} }, {}), { queued: 2 });
  assert.deepEqual(calls, ['start']);
});

test('STOP_CPAM_REAUTH delegates to the controller', async () => {
  let stopped = false;
  const router = createMessageRouter({ stopCpamReauth: async () => { stopped = true; return { ok: true }; }, getState: async () => ({}) });
  await router.handleMessage({ type: 'STOP_CPAM_REAUTH', source: 'sidepanel', payload: {} }, {});
  assert.equal(stopped, true);
});
```

- [ ] **Step 2: Run the router test to verify it fails**

Run: `node --test tests/background-cpam-reauth-router.test.js`

Expected: `START_CPAM_REAUTH` and `STOP_CPAM_REAUTH` are unhandled.

- [ ] **Step 3: Add settings and controller wiring**

Add these fields to `PERSISTED_SETTING_DEFAULTS` and their normalization cases in `normalizePersistentSettingValue`:

```js
cpamBaseUrl: '',
cpamAccessToken: '',
cpamInspectionRunId: '',
```

Normalize the URL with `MultiPageBackgroundCpamInspectionApi.normalizeBaseUrl` when non-empty, trim the token, and keep only positive integer run IDs. Add both new module paths to `background.js` `importScripts` before `background/message-router.js`. Construct `cpamReauthController` after node executors are available, injecting `chrome`, `getState`, `setState`, `broadcastDataUpdate`, `executeNode`, `requestStop`, `startCpamReauth` dependencies, and the CPAM API factory.

Add the router dependencies and cases:

```js
case 'START_CPAM_REAUTH':
  if (message.source === 'sidepanel') await lockAutomationWindowFromMessage(message, sender);
  return await startCpamReauth();
case 'STOP_CPAM_REAUTH':
  return await stopCpamReauth();
```

Do not add the CPAM token to logs, broadcasts beyond normal state synchronization, or error strings.

- [ ] **Step 4: Run the router test to verify it passes**

Run: `node --test tests/background-cpam-reauth-router.test.js`

Expected: both message cases delegate to the injected controller.

- [ ] **Step 5: Run focused regression tests**

Run: `node --test tests/background-cpa-api.test.js tests/background-panel-bridge-module.test.js tests/background-message-router-module.test.js tests/background-cpam-reauth-router.test.js`

Expected: all focused background tests pass.

- [ ] **Step 6: Commit the completed task**

This workspace has no `.git` directory. Record the changed files and test output in the final handoff instead of attempting a commit.

### Task 4: Add the CPAM ReAuth side-panel controls

**Files:**

- Modify: `sidepanel/sidepanel.html`
- Create: `sidepanel/cpam-reauth.js`
- Modify: `sidepanel/sidepanel.js`
- Modify: `sidepanel/sidepanel.css`
- Test: `tests/sidepanel-cpam-reauth.test.js`

- [ ] **Step 1: Write the failing side-panel tests**

```js
test('sidepanel contains CPAM settings and ReAuth controls without external links', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
  assert.match(html, /id="input-cpam-base-url"/);
  assert.match(html, /id="input-cpam-access-token"/);
  assert.match(html, /id="input-cpam-inspection-run-id"/);
  assert.match(html, /id="btn-start-cpam-reauth"/);
  assert.match(html, /id="btn-stop-cpam-reauth"/);
  assert.match(html, /id="cpam-reauth-summary"/);
  assert.doesNotMatch(html, /cpam.*href=/i);
});

test('CPAM panel sends START_CPAM_REAUTH and locks controls while running', async () => {
  const manager = createCpamReauthPanel({
    dom: fakeDom(), runtime: { sendMessage: async (message) => ({ message }) },
    helpers: { saveSettings: async () => {}, showToast: () => {} },
  });
  await manager.start();
  assert.equal(manager.getLastMessage().type, 'START_CPAM_REAUTH');
  manager.render({ phase: 'running', queued: 2, currentIndex: 0, succeeded: 0, failed: 0, skipped: 0 });
  assert.equal(fakeDom().btnStart.disabled, true);
});
```

- [ ] **Step 2: Run the side-panel test to verify it fails**

Run: `node --test tests/sidepanel-cpam-reauth.test.js`

Expected: missing CPAM DOM identifiers and module factory.

- [ ] **Step 3: Add markup, styles, and panel module**

Create a `data-card` with three inputs and two buttons:

```html
<div id="cpam-reauth-section" class="data-card">
  <div class="section-mini-header"><span class="section-label">CPAM ReAuth</span></div>
  <div class="data-row"><span class="data-label">服务地址</span><input id="input-cpam-base-url" class="data-input" type="url" autocomplete="off"></div>
  <div class="data-row"><span class="data-label">访问令牌</span><input id="input-cpam-access-token" class="data-input" type="password" autocomplete="off"></div>
  <div class="data-row"><span class="data-label">巡检运行 ID</span><input id="input-cpam-inspection-run-id" class="data-input" type="number" min="1" step="1"></div>
  <div class="data-row"><button id="btn-start-cpam-reauth" class="btn btn-primary" type="button">ReAuth 401</button><button id="btn-stop-cpam-reauth" class="btn btn-danger" type="button" disabled>停止</button></div>
  <p id="cpam-reauth-summary" class="setting-caption" aria-live="polite">未运行</p>
</div>
```

`createCpamReauthPanel` must expose `bindEvents`, `render`, `applySettings`, and `collectSettings`. Bind input changes through the existing save path. On start, call `saveSettings`, then send `{ type: 'START_CPAM_REAUTH', source: 'sidepanel', payload: {} }`; on stop send `STOP_CPAM_REAUTH`. Render `运行中：{currentIndex}/{queued}，成功 {succeeded}，失败 {failed}，跳过 {skipped}` while running, and the same terminal counts on completion. Use existing button, card, input, and caption styles; only add narrow class rules if layout requires them.

Load `cpam-reauth.js` before `sidepanel.js`. In `sidepanel.js`, obtain the module, pass its DOM/runtime/save helpers, include its `collectSettings()` result in `collectSettingsPayload`, call `applySettings(state)` in `applySettingsState`, and call `render(state.reauthRuntime)` whenever `DATA_UPDATED` includes `reauthRuntime`.

- [ ] **Step 4: Run the side-panel test to verify it passes**

Run: `node --test tests/sidepanel-cpam-reauth.test.js`

Expected: markup and panel behavior tests pass.

- [ ] **Step 5: Run syntax and feature regression tests**

Run: `node --check background.js; node --check sidepanel/sidepanel.js; node --test tests/cpam-inspection-api.test.js tests/cpam-reauth-controller.test.js tests/background-cpam-reauth-router.test.js tests/sidepanel-cpam-reauth.test.js`

Expected: all commands exit 0.

- [ ] **Step 6: Commit the completed task**

This workspace has no `.git` directory. Record the changed files and test output in the final handoff instead of attempting a commit.

### Task 5: Run the full regression suite

**Files:**

- Modify only if a failing test identifies a regression in the files above.

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 2: Manually verify the installed extension flow**

1. Enter separate CPA and CPAM credentials, plus a positive CPAM run ID.
2. Confirm no CPAM token appears in visible logs.
3. Start ReAuth against a run containing two 401 Codex results.
4. Confirm each account clears only OpenAI cookies, begins at OAuth login, and reaches CPA callback verification before the next begins.
5. Stop during an in-flight item and confirm no next item begins.

- [ ] **Step 3: Final handoff**

Report the CPAM configuration fields, exact 401 selection rule, the fact that CPA receives the callback URL rather than an auth-file overwrite, and all verification commands/results.
