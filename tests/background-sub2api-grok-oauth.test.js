const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadApiModule() {
  const source = fs.readFileSync('background/sub2api-api.js', 'utf8');
  const scope = {};
  return new Function('self', `${source}; return self.MultiPageBackgroundSub2ApiApi;`)(scope);
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify({ code: status >= 200 && status < 300 ? 0 : status, data });
    },
  };
}

function createState(overrides = {}) {
  return {
    sub2apiUrl: 'https://sub2api.example.com/admin/accounts',
    sub2apiEmail: 'admin@example.com',
    sub2apiPassword: 'admin-secret',
    sub2apiGroupName: 'grok-pool',
    sub2apiGroupNames: ['grok-pool'],
    sub2apiAccountPriority: 4,
    sub2apiDefaultProxyName: 'xai-proxy',
    runtimeState: {
      flowState: {
        grok: {
          register: { email: 'round@example.com' },
        },
      },
    },
    ...overrides,
  };
}

test('SUB2API API prepares Grok OAuth with grok groups and the resolved proxy', async () => {
  const moduleApi = loadApiModule();
  const requests = [];
  const api = moduleApi.createSub2ApiApi({
    normalizeSub2ApiUrl: (value) => value,
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
      const path = new URL(url).pathname;
      if (path === '/api/v1/auth/login') return jsonResponse({ access_token: 'admin-token' });
      if (path === '/api/v1/admin/groups/all') {
        return jsonResponse([{ id: 31, name: 'grok-pool', platform: 'grok' }]);
      }
      if (path === '/api/v1/admin/proxies/all') {
        return jsonResponse([{ id: 7, name: 'xai-proxy', status: 'active' }]);
      }
      if (path === '/api/v1/admin/grok/oauth/auth-url') {
        return jsonResponse({
          auth_url: 'https://auth.x.ai/oauth2/authorize?state=hidden-state',
          session_id: 'hidden-session',
          state: 'hidden-state',
        });
      }
      throw new Error(`unexpected request: ${url}`);
    },
  });

  const result = await api.prepareGrokOAuth(createState());
  const groupRequest = requests.find((request) => new URL(request.url).pathname === '/api/v1/admin/groups/all');
  const authRequest = requests.find((request) => new URL(request.url).pathname === '/api/v1/admin/grok/oauth/auth-url');

  assert.equal(new URL(groupRequest.url).searchParams.get('platform'), 'grok');
  assert.deepEqual(authRequest.body, { proxy_id: 7 });
  assert.equal(result.sessionId, 'hidden-session');
  assert.equal(result.state, 'hidden-state');
  assert.equal(result.authUrl.startsWith('https://auth.x.ai/'), true);
  assert.deepEqual(result.groupIds, [31]);
  assert.equal(result.proxyId, 7);
  assert.equal(result.accountName, 'round@example.com');
});

test('SUB2API API creates the Grok OAuth account with the registration email as name', async () => {
  const moduleApi = loadApiModule();
  const requests = [];
  const timeoutValues = [];
  const api = moduleApi.createSub2ApiApi({
    normalizeSub2ApiUrl: (value) => value,
    setTimeoutImpl(callback, timeoutMs) {
      timeoutValues.push(timeoutMs);
      return { callback };
    },
    clearTimeoutImpl() {},
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
      const path = new URL(url).pathname;
      if (path === '/api/v1/auth/login') return jsonResponse({ access_token: 'admin-token' });
      if (path === '/api/v1/admin/grok/oauth/create-from-oauth') {
        return jsonResponse({ id: 101, name: 'round@example.com', platform: 'grok', type: 'oauth' });
      }
      throw new Error(`unexpected request: ${url}`);
    },
  });

  const result = await api.createGrokAccountFromOAuth(createState(), {
    sessionId: 'hidden-session',
    state: 'hidden-state',
    proxyId: 7,
    groupIds: [31],
  }, 'visible-code');
  const createRequest = requests.find((request) => new URL(request.url).pathname === '/api/v1/admin/grok/oauth/create-from-oauth');

  assert.deepEqual(createRequest.body, {
    session_id: 'hidden-session',
    state: 'hidden-state',
    code: 'visible-code',
    name: 'round@example.com',
    proxy_id: 7,
    group_ids: [31],
    concurrency: 1,
    priority: 4,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(createRequest.body, 'rate_multiplier'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(createRequest.body, 'auto_pause_on_expired'), false);
  assert.equal(timeoutValues.includes(180000), true);
  assert.equal(result.account.id, 101);
});

test('SUB2API API rejects incomplete Grok OAuth input before sending requests', async () => {
  const moduleApi = loadApiModule();
  let fetchCount = 0;
  const api = moduleApi.createSub2ApiApi({
    normalizeSub2ApiUrl: (value) => value,
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse({});
    },
  });

  await assert.rejects(
    () => api.prepareGrokOAuth(createState({ sub2apiGroupName: '', sub2apiGroupNames: [] })),
    /请先添加 Grok SUB2API 分组/
  );
  await assert.rejects(
    () => api.createGrokAccountFromOAuth(createState(), {
      sessionId: 'session',
      state: 'state',
      groupIds: [31],
    }, ''),
    /缺少 Grok OAuth 授权码/
  );
  await assert.rejects(
    () => api.createGrokAccountFromOAuth(createState({ runtimeState: {}, grokEmail: '', email: '' }), {
      sessionId: 'session',
      state: 'state',
      groupIds: [31],
    }, 'code'),
    /缺少本轮 Grok 注册邮箱/
  );
  assert.equal(fetchCount, 0);
});

test('SUB2API API rejects a successful response without a created account id', async () => {
  const moduleApi = loadApiModule();
  const api = moduleApi.createSub2ApiApi({
    normalizeSub2ApiUrl: (value) => value,
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      if (path === '/api/v1/auth/login') return jsonResponse({ access_token: 'admin-token' });
      if (path === '/api/v1/admin/grok/oauth/create-from-oauth') return jsonResponse({});
      throw new Error(`unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    () => api.createGrokAccountFromOAuth(createState(), {
      sessionId: 'session',
      state: 'state',
      groupIds: [31],
    }, 'code'),
    /未返回有效账号/
  );
});
