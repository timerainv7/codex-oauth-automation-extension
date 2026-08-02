const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function loadCpamInspectionApiModule() {
  const source = fs.readFileSync('background/cpam-inspection-api.js', 'utf8');
  return new Function('self', `${source}; return self.MultiPageBackgroundCpamInspectionApi;`)({});
}

function createCpamInspectionApi(deps) {
  return loadCpamInspectionApiModule().createCpamInspectionApi(deps);
}

function validSettings(overrides = {}) {
  return {
    cpamBaseUrl: 'https://cpam.example.test/',
    cpamAccessToken: 'test-cpam-access-token',
    cpamInspectionRunId: '47',
    ...overrides,
  };
}

function candidate(displayAccount, fileName, authIndex, overrides = {}) {
  return {
    provider: 'codex',
    statusCode: 401,
    action: 'reauth',
    displayAccount,
    fileName,
    authIndex,
    accountId: 'account-test-id',
    ...overrides,
  };
}

test('getRunCandidates requests the normalized manual run with only the CPAM bearer token', async () => {
  const requests = [];
  const api = createCpamInspectionApi({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({ run: { id: 47 }, results: [] });
    },
  });

  await api.getRunCandidates(validSettings({
    cpamBaseUrl: 'https://cpam.example.test/base/?ignored=value#fragment',
  }));

  assert.deepEqual(requests, [{
    url: 'https://cpam.example.test/base/v0/management/codex-inspection/runs/47',
    options: {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer test-cpam-access-token',
      },
    },
  }]);
});

test('getRunCandidates preserves result order and deduplicates codex 401 reauth entries', async () => {
  const api = createCpamInspectionApi({
    fetchImpl: async () => jsonResponse({
      run: { id: 47 },
      results: [
        candidate('FIRST@EXAMPLE.TEST', 'first.json', 'a'),
        candidate('ignore@example.test', 'ignore-provider.json', 'b', { provider: 'xai' }),
        candidate('ignore@example.test', 'ignore-status.json', 'c', { statusCode: 500 }),
        candidate('ignore@example.test', 'ignore-action.json', 'd', { action: 'refresh' }),
        candidate('duplicate@example.test', 'first.json', 'a'),
        candidate('missing-file@example.test', '   ', 'e'),
        candidate('missing-index@example.test', 'missing-index.json', '   '),
        candidate('second@example.test', 'second.json', 'f', { accountId: 'account-second' }),
      ],
    }),
  });

  const result = await api.getRunCandidates(validSettings());

  assert.deepEqual(result, {
    run: { id: 47 },
    candidates: [
      {
        key: 'first.json::a',
        fileName: 'first.json',
        authIndex: 'a',
        email: 'first@example.test',
        accountId: 'account-test-id',
        position: 0,
      },
      {
        key: 'second.json::f',
        fileName: 'second.json',
        authIndex: 'f',
        email: 'second@example.test',
        accountId: 'account-second',
        position: 7,
      },
    ],
    skipped: [
      { position: 4, reason: 'duplicate' },
      { position: 5, reason: 'duplicate' },
      { position: 6, reason: 'duplicate' },
    ],
  });
});

test('getRunCandidates validates settings and CPAM responses', async () => {
  const api = createCpamInspectionApi({
    fetchImpl: async () => jsonResponse({ run: {}, results: 'invalid' }),
  });

  await assert.rejects(() => api.getRunCandidates(validSettings({ cpamBaseUrl: 'ftp://cpam.example.test' })), /HTTP|HTTPS/);
  await assert.rejects(() => api.getRunCandidates(validSettings({ cpamInspectionRunId: '0' })), /运行 ID/);
  await assert.rejects(() => api.getRunCandidates(validSettings({ cpamAccessToken: '   ' })), /访问令牌/);
  await assert.rejects(() => api.getRunCandidates(validSettings()), /results/);

  const rejectedApi = createCpamInspectionApi({
    fetchImpl: async () => jsonResponse({ error: 'inspection unavailable' }, 503),
  });
  await assert.rejects(() => rejectedApi.getRunCandidates(validSettings()), /inspection unavailable/);

  const invalidEmailApi = createCpamInspectionApi({
    fetchImpl: async () => jsonResponse({
      run: {},
      results: [candidate('not-an-email', 'invalid.json', 'a')],
    }),
  });
  assert.deepEqual(await invalidEmailApi.getRunCandidates(validSettings()), {
    run: {},
    candidates: [],
    skipped: [{ position: 0, reason: 'invalid_email' }],
  });
});
