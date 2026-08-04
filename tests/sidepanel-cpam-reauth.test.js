const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const MODULE_PATH = 'sidepanel/cpam-reauth.js';

function createElement(value = '') {
  const listeners = new Map();
  return {
    value,
    disabled: false,
    textContent: '',
    attributes: {},
    classList: {
      values: new Set(),
      toggle(name, enabled) {
        if (enabled) this.values.add(name);
        else this.values.delete(name);
      },
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    setAttribute(name, valueToSet) {
      this.attributes[name] = String(valueToSet);
    },
    dispatch(type) {
      return listeners.get(type)?.({ currentTarget: this, target: this });
    },
  };
}

function loadApi() {
  assert.equal(fs.existsSync(MODULE_PATH), true, `${MODULE_PATH} should exist`);
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  const windowObject = {};
  new Function('window', source)(windowObject);
  return windowObject.SidepanelCpamReauth;
}

function createHarness(overrides = {}) {
  const dom = {
    inputBaseUrl: createElement(' https://cpam.example.test/ '),
    inputAccessToken: createElement(' secret-token '),
    inputInspectionRunId: createElement(' 42 '),
    btnStart: createElement(),
    btnStop: createElement(),
    summary: createElement(),
    results: createElement(),
  };
  const events = [];
  const api = loadApi();
  const panel = api.createCpamReauthPanel({
    dom,
    runtime: {
      sendMessage: async (message) => events.push({ type: 'message', message }),
    },
    helpers: {
      saveSettings: overrides.saveSettings || (async () => events.push({ type: 'save' })),
    },
    ...overrides,
  });
  return { dom, events, panel };
}

test('CPAM ReAuth panel saves settings before sending its start message', async () => {
  const { dom, events, panel } = createHarness();
  panel.bindEvents();

  await dom.btnStart.dispatch('click');

  assert.deepEqual(events, [
    { type: 'save' },
    {
      type: 'message',
      message: { type: 'START_CPAM_REAUTH', source: 'sidepanel', payload: {} },
    },
  ]);
});

test('CPAM ReAuth panel starts with a blank inspection run ID', async () => {
  const { dom, events, panel } = createHarness();
  dom.inputInspectionRunId.value = '   ';
  panel.bindEvents();

  await dom.btnStart.dispatch('click');

  assert.deepEqual(events, [
    { type: 'save' },
    {
      type: 'message',
      message: { type: 'START_CPAM_REAUTH', source: 'sidepanel', payload: {} },
    },
  ]);
});

test('CPAM ReAuth panel sends a stop message and input changes save without logging', async () => {
  const { dom, events, panel } = createHarness();
  panel.bindEvents();

  await dom.inputBaseUrl.dispatch('input');
  await dom.btnStop.dispatch('click');

  assert.deepEqual(events, [
    { type: 'save' },
    {
      type: 'message',
      message: { type: 'STOP_CPAM_REAUTH', source: 'sidepanel', payload: {} },
    },
  ]);
});

test('CPAM ReAuth panel does not start with missing local settings', async () => {
  const { dom, events, panel } = createHarness();
  dom.inputAccessToken.value = '';
  panel.bindEvents();

  await dom.btnStart.dispatch('click');

  assert.deepEqual(events, []);
  assert.equal(dom.summary.textContent, '请填写 CPAM 地址和访问令牌。');
});

test('CPAM ReAuth panel does not start when saving settings fails and shows a save error', async () => {
  const saveCalls = [];
  const { dom, events, panel } = createHarness({
    saveSettings: async () => {
      saveCalls.push('save');
      throw new Error('save failed');
    },
  });
  panel.bindEvents();

  await dom.btnStart.dispatch('click');

  assert.deepEqual(saveCalls, ['save']);
  assert.deepEqual(events, []);
  assert.equal(dom.summary.textContent, '无法保存 CPAM ReAuth 设置。');
});

test('CPAM ReAuth panel waits for input saves before its authoritative start save', async () => {
  const saves = [];
  const resolvers = [];
  let harness;
  harness = createHarness({
    saveSettings: () => new Promise((resolve) => {
      saves.push({
        cpamBaseUrl: harness.dom.inputBaseUrl.value,
        cpamAccessToken: harness.dom.inputAccessToken.value,
        cpamInspectionRunId: harness.dom.inputInspectionRunId.value,
      });
      resolvers.push(resolve);
    }),
  });
  const { dom, events, panel } = harness;
  panel.bindEvents();

  dom.inputBaseUrl.value = 'https://stale.example.test';
  dom.inputBaseUrl.dispatch('input');
  await Promise.resolve();
  dom.inputBaseUrl.value = 'https://authoritative.example.test';
  const startPromise = dom.btnStart.dispatch('click');

  assert.equal(saves.length, 1);
  assert.equal(dom.btnStart.disabled, true);
  resolvers.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(saves, [
    {
      cpamBaseUrl: 'https://stale.example.test',
      cpamAccessToken: ' secret-token ',
      cpamInspectionRunId: ' 42 ',
    },
    {
      cpamBaseUrl: 'https://authoritative.example.test',
      cpamAccessToken: ' secret-token ',
      cpamInspectionRunId: ' 42 ',
    },
  ]);
  resolvers.shift()();
  await startPromise;

  assert.deepEqual(events, [
    {
      type: 'message',
      message: { type: 'START_CPAM_REAUTH', source: 'sidepanel', payload: {} },
    },
  ]);
});

test('CPAM ReAuth panel locks start immediately and issues one start message for double clicks', async () => {
  const resolvers = [];
  const { dom, events, panel } = createHarness({
    saveSettings: () => new Promise((resolve) => resolvers.push(resolve)),
  });
  panel.bindEvents();

  const firstStart = dom.btnStart.dispatch('click');
  const secondStart = dom.btnStart.dispatch('click');

  assert.equal(dom.btnStart.disabled, true);
  await Promise.resolve();
  assert.equal(resolvers.length, 1);
  resolvers.shift()();
  await Promise.all([firstStart, secondStart]);

  assert.deepEqual(events, [
    {
      type: 'message',
      message: { type: 'START_CPAM_REAUTH', source: 'sidepanel', payload: {} },
    },
  ]);
});

test('CPAM ReAuth panel locks inputs and ignores input saves after the authoritative start save begins', async () => {
  const saves = [];
  const resolvers = [];
  let harness;
  harness = createHarness({
    saveSettings: () => new Promise((resolve) => {
      saves.push({
        cpamBaseUrl: harness.dom.inputBaseUrl.value,
        cpamAccessToken: harness.dom.inputAccessToken.value,
        cpamInspectionRunId: harness.dom.inputInspectionRunId.value,
      });
      resolvers.push(resolve);
    }),
  });
  const { dom, events, panel } = harness;
  panel.bindEvents();

  const startPromise = dom.btnStart.dispatch('click');
  await Promise.resolve();
  assert.equal(dom.inputBaseUrl.disabled, true);
  assert.equal(dom.inputAccessToken.disabled, true);
  assert.equal(dom.inputInspectionRunId.disabled, true);
  assert.equal(dom.btnStart.disabled, true);
  assert.equal(saves.length, 1);

  dom.inputBaseUrl.value = 'https://racing-input.example.test';
  dom.inputBaseUrl.dispatch('input');
  await Promise.resolve();
  assert.deepEqual(saves, [
    {
      cpamBaseUrl: ' https://cpam.example.test/ ',
      cpamAccessToken: ' secret-token ',
      cpamInspectionRunId: ' 42 ',
    },
  ]);
  assert.equal(resolvers.length, 1);

  resolvers.shift()();
  await startPromise;
  assert.deepEqual(events, [
    {
      type: 'message',
      message: { type: 'START_CPAM_REAUTH', source: 'sidepanel', payload: {} },
    },
  ]);
});

test('CPAM ReAuth panel surfaces the actual start runtime error instead of a save error', async () => {
  const { dom, events, panel } = createHarness({
    runtime: {
      sendMessage: async () => {
        throw new Error('START_CPAM_REAUTH rejected by background');
      },
    },
  });
  panel.bindEvents();
  panel.render({ phase: 'completed', queued: 1, currentIndex: 0, succeeded: 1, failed: 0, skipped: 0 });

  await dom.btnStart.dispatch('click');

  assert.deepEqual(events, [{ type: 'save' }]);
  assert.equal(dom.summary.textContent, 'START_CPAM_REAUTH rejected by background');
  assert.equal(dom.inputBaseUrl.disabled, false);
  assert.equal(dom.btnStart.disabled, false);
  assert.equal(dom.btnStop.disabled, true);
});

test('CPAM ReAuth panel surfaces a background response error and restores controls', async () => {
  const { dom, events, panel } = createHarness({
    runtime: {
      sendMessage: async (message) => {
        events.push({ type: 'message', message });
        return { error: 'CPAM ReAuth requires the CPA target.' };
      },
    },
  });
  panel.bindEvents();
  panel.render({ phase: 'completed', queued: 1, currentIndex: 0, succeeded: 1, failed: 0, skipped: 0 });

  await dom.btnStart.dispatch('click');

  assert.deepEqual(events, [
    { type: 'save' },
    {
      type: 'message',
      message: { type: 'START_CPAM_REAUTH', source: 'sidepanel', payload: {} },
    },
  ]);
  assert.equal(dom.summary.textContent, 'CPAM ReAuth requires the CPA target.');
  assert.equal(dom.summary.textContent.includes('secret-token'), false);
  assert.equal(dom.inputBaseUrl.disabled, false);
  assert.equal(dom.btnStart.disabled, false);
  assert.equal(dom.btnStop.disabled, true);
});

test('CPAM ReAuth panel collects and applies the persisted settings', () => {
  const { dom, panel } = createHarness();

  assert.deepEqual(panel.collectSettings(), {
    cpamBaseUrl: 'https://cpam.example.test/',
    cpamAccessToken: 'secret-token',
    cpamInspectionRunId: '42',
  });

  panel.applySettings({
    cpamBaseUrl: 'https://other.example.test',
    cpamAccessToken: 'new-token',
    cpamInspectionRunId: '7',
  });

  assert.equal(dom.inputBaseUrl.value, 'https://other.example.test');
  assert.equal(dom.inputAccessToken.value, 'new-token');
  assert.equal(dom.inputInspectionRunId.value, '7');
});

test('CPAM ReAuth panel locks active runtime controls and renders count-only summaries', () => {
  const { dom, panel } = createHarness();
  ['initializing', 'running', 'stopping'].forEach((phase) => {
    panel.render({
      phase,
      currentIndex: 2,
      queued: 5,
      succeeded: 1,
      failed: 1,
      skipped: 2,
      currentItem: { email: 'private@example.test' },
    });

    assert.equal(dom.inputBaseUrl.disabled, true);
    assert.equal(dom.inputAccessToken.disabled, true);
    assert.equal(dom.inputInspectionRunId.disabled, true);
    assert.equal(dom.btnStart.disabled, true);
    assert.equal(dom.btnStop.disabled, false);
    assert.equal(dom.summary.textContent, '运行中：2/5，成功 1，失败 1，跳过 2');
  });
  assert.equal(dom.summary.textContent.includes('private@example.test'), false);
  assert.equal(dom.summary.textContent.includes('secret-token'), false);

  [
    ['completed', '已完成：成功 3，失败 1，跳过 1'],
    ['failed', '执行失败：成功 3，失败 1，跳过 1'],
    ['stopped', '已停止：成功 3，失败 1，跳过 1'],
  ].forEach(([phase, summary]) => {
    panel.render({ phase, queued: 5, currentIndex: 4, succeeded: 3, failed: 1, skipped: 1 });
    assert.equal(dom.inputBaseUrl.disabled, false);
    assert.equal(dom.btnStart.disabled, false);
    assert.equal(dom.btnStop.disabled, true);
    assert.equal(dom.summary.textContent, summary);
  });
});

test('CPAM ReAuth panel renders terminal summary with full-email failure and skip details', () => {
  const { dom, panel } = createHarness();
  panel.render({
    phase: 'completed',
    queued: 3,
    succeeded: 1,
    failed: 1,
    skipped: 1,
    items: [
      { email: 'ok@example.test', status: 'succeeded' },
      { email: 'gone@example.test', status: 'failed', step: 'fetch-login-code', error: '账号已被删除或停用（account_deactivated）' },
      { email: 'duplicate@example.test', status: 'skipped', reason: 'duplicate' },
    ],
  });

  assert.equal(dom.results.hidden, false);
  assert.match(dom.results.textContent, /成功 1 个.*失败 1 个.*跳过 1 个/s);
  assert.match(dom.results.textContent, /gone@example\.test.*登录验证码.*account_deactivated/s);
  assert.match(dom.results.textContent, /duplicate@example\.test.*重复/s);

  panel.render({ phase: 'running', queued: 3, currentIndex: 1, succeeded: 0, failed: 0, skipped: 0, items: [] });
  assert.equal(dom.results.hidden, true);
  assert.equal(dom.results.textContent, '');
});

test('CPAM ReAuth markup and sidepanel integration expose no external link and all static hooks', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
  const sidepanelSource = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');
  const cardStart = html.indexOf('<div id="cpam-reauth-section"');
  const cardEnd = html.indexOf('<div id="status-bar"', cardStart);

  assert.ok(cardStart >= 0 && cardEnd > cardStart, 'CPAM ReAuth data card should exist');
  const card = html.slice(cardStart, cardEnd);
  assert.match(card, /class="data-card/);
  assert.match(card, /id="input-cpam-base-url"[^>]*type="url"/);
  assert.match(card, /id="input-cpam-base-url"[^>]*autocomplete="off"/);
  assert.match(card, /id="input-cpam-access-token"[^>]*type="password"/);
  assert.match(card, /检查运行 ID（可选）/);
  assert.match(card, /id="input-cpam-inspection-run-id"[^>]*type="number"[^>]*min="1"[^>]*step="1"/);
  assert.ok(
    card.indexOf('id="input-cpam-inspection-run-id"') < card.indexOf('留空自动使用最新已完成巡检'),
    'the automatic-selection caption should follow the inspection run ID field'
  );
  assert.doesNotMatch(card.match(/<button id="btn-start-cpam-reauth"[^>]*>/)[0], /\sdisabled(?:[\s=>]|$)/);
  assert.match(card, /id="btn-stop-cpam-reauth"[^>]*disabled/);
  assert.match(card, /<button id="btn-stop-cpam-reauth" class="btn btn-danger btn-sm"[^>]*>/);
  assert.ok(card.includes('<p id="cpam-reauth-summary" class="setting-caption" aria-live="polite">未运行</p>'));
  assert.match(card, /id="cpam-reauth-results"/);
  assert.equal(/\bhref\s*=/.test(card), false);
  assert.ok(html.indexOf('<script src="cpam-reauth.js"></script>') < html.indexOf('<script src="sidepanel.js"></script>'));
  assert.match(sidepanelSource, /SidepanelCpamReauth\?\.createCpamReauthPanel/);
  assert.match(sidepanelSource, /cpamReauthPanel\.collectSettings\?\.\(\)/);
  assert.match(sidepanelSource, /cpamReauthPanel\.applySettings\?\.\(state\)/);
  assert.match(sidepanelSource, /cpamReauthPanel\.render\?\.\(state\?\.reauthRuntime\)/);
  assert.match(sidepanelSource, /message\.payload\.reauthRuntime/);
  assert.equal(
    (sidepanelSource.match(/typeof cpamReauthPanel !== 'undefined'\s*&&\s*cpamReauthPanel/g) || []).length,
    3,
    'extracted sidepanel functions must guard the module-scoped CPAM panel reference'
  );
});
