const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadDuckTokenProviderApi() {
  const source = fs.readFileSync('background/duck-token-provider.js', 'utf8');
  return new Function('self', `${source}; return self.MultiPageBackgroundDuckTokenProvider;`)({});
}

function createWebRequestHarness() {
  let listener = null;
  const calls = [];
  return {
    calls,
    emit(headers = []) {
      listener?.({ requestHeaders: headers });
    },
    api: {
      webRequest: {
        onBeforeSendHeaders: {
          addListener(nextListener, filter, extraInfoSpec) {
            listener = nextListener;
            calls.push({ type: 'add', filter, extraInfoSpec });
          },
          removeListener(nextListener) {
            if (listener === nextListener) {
              listener = null;
            }
            calls.push({ type: 'remove' });
          },
          hasListener(nextListener) {
            return listener === nextListener;
          },
        },
      },
    },
  };
}

test('Duck token provider normalizes token and creates duck address through DDG API', async () => {
  const api = loadDuckTokenProviderApi();
  const requests = [];
  const provider = api.createDuckTokenProvider({
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ address: 'fresh-alias' }),
      };
    },
    throwIfStopped: () => {},
  });

  assert.equal(api.normalizeDuckDdgToken('Bearer token-1'), 'token-1');

  const email = await provider.requestDuckAddressWithToken('Bearer ddg-token');

  assert.equal(email, 'fresh-alias@duck.com');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://quack.duckduckgo.com/api/email/addresses');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer ddg-token');
});

test('Duck token provider marks DDG daily limit failures for auto-run hard stop', async () => {
  const api = loadDuckTokenProviderApi();
  const provider = api.createDuckTokenProvider({
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: 'daily limit reached' }),
    }),
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => provider.requestDuckAddressWithToken('ddg-token'),
    /DDG_DAILY_LIMIT::DuckDuckGo 地址生成已达到每日限制/
  );
  assert.equal(api.isDuckDdgDailyLimitFailure(new Error('DDG_DAILY_LIMIT::daily limit reached')), true);
});

test('Duck token provider captures Authorization Bearer token from DDG request and persists it', async () => {
  const api = loadDuckTokenProviderApi();
  const webRequest = createWebRequestHarness();
  const logs = [];
  const persisted = [];
  const broadcasts = [];
  const provider = api.createDuckTokenProvider({
    addLog: async (message, level = 'info') => logs.push({ message, level }),
    broadcastDataUpdate: (payload) => broadcasts.push(payload),
    chromeApi: webRequest.api,
    reuseOrCreateTab: async (source, url) => {
      assert.equal(source, 'duck-mail');
      assert.equal(url, 'https://duckduckgo.com/email/settings/autofill');
    },
    sendToContentScript: async () => {
      queueMicrotask(() => {
        webRequest.emit([
          { name: 'Authorization', value: 'Bearer captured-token' },
        ]);
      });
      return { email: 'side-effect@duck.com', generated: true };
    },
    setPersistentSettings: async (updates) => persisted.push(updates),
    throwIfStopped: () => {},
  });

  const token = await provider.ensureDuckDdgToken({}, { captureTimeoutMs: 1000 });

  assert.equal(token, 'captured-token');
  assert.deepEqual(persisted, [{ duckDdgToken: 'captured-token' }]);
  assert.deepEqual(broadcasts, [{ duckDdgToken: 'captured-token' }]);
  assert.equal(webRequest.calls[0].type, 'add');
  assert.equal(webRequest.calls.at(-1).type, 'remove');
  assert.ok(logs.some((entry) => entry.message.includes('已自动获取并保存 DDG Token')));
});

test('Duck token provider reports a Chinese error when DDG page cannot trigger token request', async () => {
  const api = loadDuckTokenProviderApi();
  const webRequest = createWebRequestHarness();
  const provider = api.createDuckTokenProvider({
    chromeApi: webRequest.api,
    reuseOrCreateTab: async () => {},
    sendToContentScript: async () => ({ error: 'login required' }),
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => provider.ensureDuckDdgToken({}, { captureTimeoutMs: 1000 }),
    /DuckDuckGo 未登录或 Email Protection 页面不可用/
  );
});
