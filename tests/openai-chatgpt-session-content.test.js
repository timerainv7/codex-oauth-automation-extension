const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function createContentHarness(fetchImpl) {
  const source = fs.readFileSync('flows/openai/content/chatgpt-session.js', 'utf8');
  const listeners = [];
  const context = {
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            listeners.push(listener);
          },
        },
      },
    },
    console: { error() {}, info() {}, log() {}, warn() {} },
    fetch: fetchImpl,
    globalThis: null,
    self: null,
    window: null,
  };
  context.globalThis = context;
  context.self = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);

  assert.equal(listeners.length, 1);

  return {
    listener: listeners[0],
    async send(message) {
      return await new Promise((resolve) => {
        const keepChannelOpen = listeners[0](message, {}, resolve);
        assert.equal(keepChannelOpen, true);
      });
    },
  };
}

test('ChatGPT session content script reads the current session through the generic protocol', async () => {
  const fetchCalls = [];
  const harness = createContentHarness(async (url, options = {}) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: 'session-access-token',
        user: { email: 'flow@example.com' },
      }),
    };
  });

  const result = await harness.send({
    type: 'OPENAI_SESSION_GET_CURRENT',
    source: 'background',
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, '/api/auth/session');
  assert.equal(fetchCalls[0].options.credentials, 'include');
  assert.equal(result.ok, true);
  assert.equal(result.accessToken, 'session-access-token');
  assert.equal(result.session.user.email, 'flow@example.com');
});

test('ChatGPT session content script ignores unrelated messages and non-background callers', () => {
  let fetchCount = 0;
  const harness = createContentHarness(async () => {
    fetchCount += 1;
    throw new Error('unexpected fetch');
  });

  assert.equal(harness.listener({ type: 'PING', source: 'background' }, {}, () => {}), undefined);
  assert.equal(harness.listener({ type: 'OPENAI_SESSION_GET_CURRENT', source: 'sidepanel' }, {}, () => {}), undefined);
  assert.equal(fetchCount, 0);
});

test('ChatGPT session content script returns protocol errors without exposing response bodies', async () => {
  const harness = createContentHarness(async () => ({
    ok: false,
    status: 503,
    json: async () => ({ accessToken: 'must-not-be-read' }),
  }));

  const result = await harness.send({
    type: 'OPENAI_SESSION_GET_CURRENT',
    source: 'background',
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /HTTP 503/);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'session'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'accessToken'), false);
});
