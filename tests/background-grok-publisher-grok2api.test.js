const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadPublisherApi() {
  const stateSource = fs.readFileSync('flows/grok/background/state.js', 'utf8');
  const publisherSource = fs.readFileSync('flows/grok/background/publisher-grok2api.js', 'utf8');
  const globalScope = {};
  new Function('self', `${stateSource}; ${publisherSource}; return self;`)(globalScope);
  return globalScope.MultiPageBackgroundGrokPublisherGrok2Api;
}

function createTextResponse(text, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    text: async () => text,
  };
}

function createJsonResponse(payload, status = 200) {
  return createTextResponse(JSON.stringify(payload), status);
}

function getGrokRuntime(state = {}) {
  return state?.runtimeState?.flowState?.grok || {};
}

test('grok2api publisher exposes helpers and normalizes upload URL to HTTP origin', () => {
  const api = loadPublisherApi();

  assert.equal(typeof api?.createGrok2ApiPublisher, 'function');
  assert.equal(
    api.buildGrok2ApiTokensUrl('https://grok2api.example.com/admin/deep/path?token=ignored'),
    'https://grok2api.example.com/admin/api/tokens/add'
  );
  assert.equal(
    api.buildGrok2ApiTokensUrl('127.0.0.1:8000/admin'),
    'http://127.0.0.1:8000/admin/api/tokens/add'
  );
  assert.throws(() => api.buildGrok2ApiTokensUrl(''), /缺少 grok2api 地址/);
  assert.throws(() => api.buildGrok2ApiTokensUrl('ftp:\/\/example.com'), /只支持 http 或 https/);
});

test('grok2api publisher posts one SSO token to the fixed auto pool', async () => {
  const api = loadPublisherApi();
  const requests = [];

  const result = await api.uploadGrokSsoToGrok2Api(
    'https://grok2api.example.com/admin/path',
    ' app-key ',
    'grok-sso-token',
    async (url, options = {}) => {
      requests.push({
        url,
        method: options.method,
        headers: options.headers,
        body: JSON.parse(options.body),
        signal: options.signal,
      });
      return createJsonResponse({ status: 'success', count: 1, skipped: 0 });
    }
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://grok2api.example.com/admin/api/tokens/add');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].headers.Authorization, 'Bearer app-key');
  assert.equal(requests[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(requests[0].body, {
    tokens: ['grok-sso-token'],
    pool: 'auto',
  });
  assert.ok(requests[0].signal);
  assert.deepEqual(result, {
    endpointUrl: 'https://grok2api.example.com/admin/api/tokens/add',
    count: 1,
    skipped: 0,
    message: '新增 1 个，跳过 0 个',
  });
});

test('grok2api publisher treats a skipped duplicate as idempotent success', async () => {
  const api = loadPublisherApi();

  const result = await api.uploadGrokSsoToGrok2Api(
    'http://127.0.0.1:8000',
    'app-key',
    'duplicate-sso',
    async () => createJsonResponse({ status: 'success', count: 0, skipped: 1 })
  );

  assert.equal(result.count, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.message, '新增 0 个，跳过 1 个');
});

test('grok2api publisher requires credentials and a positive success count', async () => {
  const api = loadPublisherApi();
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    return createJsonResponse({ status: 'success', count: 1, skipped: 0 });
  };

  await assert.rejects(
    () => api.uploadGrokSsoToGrok2Api('http://127.0.0.1:8000', '', 'sso', fetchImpl),
    /缺少 grok2api Admin Key/
  );
  await assert.rejects(
    () => api.uploadGrokSsoToGrok2Api('http://127.0.0.1:8000', 'key', '', fetchImpl),
    /缺少 Grok SSO Cookie/
  );
  assert.equal(requestCount, 0);

  await assert.rejects(
    () => api.uploadGrokSsoToGrok2Api(
      'http://127.0.0.1:8000',
      'key',
      'sso',
      async () => createJsonResponse({ status: 'success', count: 0, skipped: 0 })
    ),
    /未新增或跳过任何账号/
  );
});

test('grok2api publisher converts FastAPI, message, and non-JSON errors to safe messages', async () => {
  const api = loadPublisherApi();

  await assert.rejects(
    () => api.uploadGrokSsoToGrok2Api(
      'http://127.0.0.1:8000',
      'secret-key',
      'secret-sso',
      async () => createJsonResponse({ detail: 'invalid token secret-sso' }, 422)
    ),
    (error) => {
      assert.match(error.message, /invalid token \[REDACTED\]/);
      assert.doesNotMatch(error.message, /secret-sso|secret-key/);
      return true;
    }
  );
  await assert.rejects(
    () => api.uploadGrokSsoToGrok2Api(
      'http://127.0.0.1:8000',
      'secret-key',
      'secret-sso',
      async () => createJsonResponse({ message: 'permission denied for secret-key' }, 403)
    ),
    (error) => {
      assert.match(error.message, /permission denied for \[REDACTED\]/);
      assert.doesNotMatch(error.message, /secret-sso|secret-key/);
      return true;
    }
  );
  await assert.rejects(
    () => api.uploadGrokSsoToGrok2Api(
      'http://127.0.0.1:8000',
      'secret-key',
      'secret-sso',
      async () => createTextResponse('upstream unavailable', 502)
    ),
    /grok2api SSO 上传失败：upstream unavailable/
  );
});

test('grok2api publisher aborts requests after the configured timeout', async () => {
  const api = loadPublisherApi();

  await assert.rejects(
    () => api.uploadGrokSsoToGrok2Api(
      'http://127.0.0.1:8000',
      'key',
      'sso',
      (_url, options = {}) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason));
      }),
      { timeoutMs: 5 }
    ),
    /grok2api 上传超时/
  );
});

test('grok2api executor reads latest canonical state and completes with target-neutral upload runtime', async () => {
  const api = loadPublisherApi();
  const requests = [];
  const logs = [];
  const completed = [];
  let liveState = {
    grok2ApiUrl: 'https://stale.example.com',
    grok2ApiAdminKey: 'stale-key',
    grokSsoCookie: 'stale-sso',
    settingsState: {
      flows: {
        grok: {
          targets: {
            grok2api: {
              baseUrl: 'https://grok2api.example.com/admin',
              apiKey: 'live-key',
            },
          },
        },
      },
    },
    runtimeState: {
      flowState: {
        grok: {
          sso: { currentCookie: 'live-sso' },
        },
      },
    },
  };
  const publisher = api.createGrok2ApiPublisher({
    addLog: async (message, level) => logs.push({ message, level }),
    completeNodeFromBackground: async (nodeId, payload) => completed.push({ nodeId, payload }),
    fetchImpl: async (url, options = {}) => {
      requests.push({
        url,
        authorization: options.headers.Authorization,
        body: JSON.parse(options.body),
      });
      return createJsonResponse({ status: 'success', count: 0, skipped: 1 });
    },
    getState: async () => ({ ...liveState }),
    setState: async (updates = {}) => {
      liveState = {
        ...liveState,
        ...updates,
        runtimeState: {
          ...(liveState.runtimeState || {}),
          ...(updates.runtimeState || {}),
          flowState: {
            ...(liveState.runtimeState?.flowState || {}),
            ...(updates.runtimeState?.flowState || {}),
          },
        },
      };
    },
  });

  await publisher.executeGrokUploadSsoToGrok2Api({
    nodeId: 'grok-upload-sso-to-grok2api',
    grok2ApiAdminKey: 'request-stale-key',
    grokSsoCookie: 'request-stale-sso',
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://grok2api.example.com/admin/api/tokens/add');
  assert.equal(requests[0].authorization, 'Bearer live-key');
  assert.deepEqual(requests[0].body, { tokens: ['live-sso'], pool: 'auto' });
  assert.equal(completed.length, 1);
  assert.equal(completed[0].nodeId, 'grok-upload-sso-to-grok2api');
  assert.equal(getGrokRuntime(completed[0].payload).upload.targetId, 'grok2api');
  assert.equal(getGrokRuntime(completed[0].payload).upload.status, 'uploaded');
  assert.equal(getGrokRuntime(completed[0].payload).upload.message, '新增 0 个，跳过 1 个');
  assert.equal(
    getGrokRuntime(completed[0].payload).upload.targetUrl,
    'https://grok2api.example.com/admin/api/tokens/add'
  );
  assert.equal(typeof getGrokRuntime(completed[0].payload).upload.uploadedAt, 'number');
  const completedRuntime = getGrokRuntime(completed[0].payload);
  const serialized = JSON.stringify({
    logs,
    upload: completedRuntime.upload,
    lastError: completedRuntime.session?.lastError,
  });
  assert.doesNotMatch(serialized, /live-sso|live-key|request-stale-sso|request-stale-key/);
});

test('grok2api executor persists a redacted failure without completing the node', async () => {
  const api = loadPublisherApi();
  const logs = [];
  const completed = [];
  let liveState = {
    settingsState: {
      flows: {
        grok: {
          targets: {
            grok2api: {
              baseUrl: 'https://grok2api.example.com',
              apiKey: 'secret-key',
            },
          },
        },
      },
    },
    runtimeState: {
      flowState: {
        grok: {
          sso: { currentCookie: 'secret-sso' },
        },
      },
    },
  };
  const publisher = api.createGrok2ApiPublisher({
    addLog: async (message, level) => logs.push({ message, level }),
    completeNodeFromBackground: async (nodeId, payload) => completed.push({ nodeId, payload }),
    fetchImpl: async () => createJsonResponse({
      detail: 'rejected secret-sso with secret-key',
    }, 422),
    getState: async () => ({ ...liveState }),
    setState: async (updates = {}) => {
      liveState = {
        ...liveState,
        ...updates,
        runtimeState: {
          ...(liveState.runtimeState || {}),
          ...(updates.runtimeState || {}),
          flowState: {
            ...(liveState.runtimeState?.flowState || {}),
            ...(updates.runtimeState?.flowState || {}),
          },
        },
      };
    },
  });

  await assert.rejects(
    () => publisher.executeGrokUploadSsoToGrok2Api({ nodeId: 'grok-upload-sso-to-grok2api' }),
    /rejected \[REDACTED\] with \[REDACTED\]/
  );

  assert.equal(completed.length, 0);
  assert.equal(getGrokRuntime(liveState).upload.targetId, 'grok2api');
  assert.equal(getGrokRuntime(liveState).upload.status, 'error');
  assert.equal(getGrokRuntime(liveState).upload.uploadedAt, 0);
  assert.match(getGrokRuntime(liveState).upload.message, /\[REDACTED\]/);
  const failedRuntime = getGrokRuntime(liveState);
  const serialized = JSON.stringify({
    logs,
    upload: failedRuntime.upload,
    lastError: failedRuntime.session?.lastError,
  });
  assert.doesNotMatch(serialized, /secret-sso|secret-key/);
});
