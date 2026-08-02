const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadAgentIdentityApi() {
  const source = fs.readFileSync('flows/openai/background/agent-identity.js', 'utf8');
  const globalScope = {};
  new Function('self', `${source}; return self;`)(globalScope);
  return globalScope.MultiPageBackgroundOpenAiAgentIdentity;
}

function encodeBase64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function createJwtToken(payload = {}) {
  return [
    encodeBase64UrlJson({ alg: 'EdDSA', typ: 'JWT' }),
    encodeBase64UrlJson(payload),
    'signature',
  ].join('.');
}

function createJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    text: async () => JSON.stringify(payload),
  };
}

test('Agent Identity decodes JWT claims and resolves OpenAI identity with explicit fallback order', () => {
  const api = loadAgentIdentityApi();
  const token = createJwtToken({
    sub: 'subject-user',
    email: 'claim@example.com',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'account-123',
      chatgpt_user_id: 'chatgpt-user',
      user_id: 'auth-user',
      chatgpt_plan_type: 'plus',
    },
    'https://api.openai.com/profile': {
      email: 'profile@example.com',
    },
  });

  assert.equal(api.decodeJwtPayload(token).sub, 'subject-user');
  assert.deepEqual(api.readOpenAiIdentity(token, {
    user: { email: 'session@example.com' },
  }), {
    accountId: 'account-123',
    userId: 'chatgpt-user',
    email: 'profile@example.com',
    planType: 'plus',
  });

  const authUserToken = createJwtToken({
    sub: 'subject-user',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'account-456',
      user_id: 'auth-user',
    },
  });
  assert.equal(api.readOpenAiIdentity(authUserToken, {
    user: { email: 'session@example.com' },
  }).userId, 'auth-user');
  assert.equal(api.readOpenAiIdentity(authUserToken, {
    user: { email: 'session@example.com' },
  }).email, 'session@example.com');
  assert.equal(api.readOpenAiIdentity(authUserToken, {}).planType, 'free');

  const subjectToken = createJwtToken({
    sub: 'subject-user',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'account-789',
    },
  });
  assert.equal(api.readOpenAiIdentity(subjectToken, {}).userId, 'subject-user');
});

test('Agent Identity rejects malformed tokens and missing required claims without echoing the token', () => {
  const api = loadAgentIdentityApi();
  const missingClaimsToken = createJwtToken({ email: 'owner@example.com' });

  for (const token of ['not-a-jwt', missingClaimsToken]) {
    assert.throws(
      () => api.readOpenAiIdentity(token, {}),
      (error) => {
        assert.equal(error.message.includes(token), false);
        assert.match(error.message, /accessToken|账号标识/);
        return true;
      }
    );
  }
});

test('Agent Identity encodes a 32-byte Ed25519 public key as an OpenSSH blob', () => {
  const api = loadAgentIdentityApi();
  const rawPublicKey = Uint8Array.from({ length: 32 }, (_value, index) => index);
  const algorithm = Buffer.from('ssh-ed25519', 'utf8');
  const expectedBlob = Buffer.alloc(4 + algorithm.length + 4 + rawPublicKey.length);
  expectedBlob.writeUInt32BE(algorithm.length, 0);
  algorithm.copy(expectedBlob, 4);
  expectedBlob.writeUInt32BE(rawPublicKey.length, 4 + algorithm.length);
  Buffer.from(rawPublicKey).copy(expectedBlob, 8 + algorithm.length);

  assert.equal(
    api.encodeSshEd25519PublicKey(rawPublicKey),
    `ssh-ed25519 ${expectedBlob.toString('base64')}`
  );
  assert.throws(
    () => api.encodeSshEd25519PublicKey(Uint8Array.from([1, 2, 3])),
    /32 字节/
  );
});

test('Agent Identity registers one Ed25519 key and builds auth.json without the access token', async () => {
  const api = loadAgentIdentityApi();
  const accessToken = createJwtToken({
    sub: 'subject-user',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'account-123',
      chatgpt_user_id: 'chatgpt-user',
      chatgpt_plan_type: 'team',
    },
    'https://api.openai.com/profile': {
      email: 'owner@example.com',
    },
  });
  const privateKeyBytes = Uint8Array.from([48, 5, 1, 2, 3, 4, 5]);
  const publicKeyBytes = Uint8Array.from({ length: 32 }, () => 7);
  const cryptoCalls = [];
  const fetchCalls = [];

  const result = await api.createAgentIdentity(accessToken, {
    user: { email: 'session@example.com' },
  }, {
    cryptoImpl: {
      subtle: {
        async generateKey(algorithm, extractable, usages) {
          cryptoCalls.push({ type: 'generate', algorithm, extractable, usages });
          return { privateKey: { id: 'private' }, publicKey: { id: 'public' } };
        },
        async exportKey(format, key) {
          cryptoCalls.push({ type: 'export', format, key });
          return format === 'pkcs8'
            ? privateKeyBytes.buffer
            : publicKeyBytes.buffer;
        },
      },
    },
    fetchImpl: async (url, options = {}) => {
      fetchCalls.push({
        url,
        method: options.method,
        headers: options.headers,
        body: JSON.parse(options.body),
        hasSignal: Boolean(options.signal),
      });
      return createJsonResponse({ agent_runtime_id: 'agent-runtime-123' });
    },
  });

  assert.deepEqual(cryptoCalls[0], {
    type: 'generate',
    algorithm: { name: 'Ed25519' },
    extractable: true,
    usages: ['sign', 'verify'],
  });
  assert.deepEqual(cryptoCalls.slice(1).map((call) => call.format).sort(), ['pkcs8', 'raw']);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://auth.openai.com/api/accounts/v1/agent/register');
  assert.equal(fetchCalls[0].method, 'POST');
  assert.equal(fetchCalls[0].headers.Authorization, `Bearer ${accessToken}`);
  assert.equal(fetchCalls[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(fetchCalls[0].body.abom, {
    agent_version: '0.138.0-alpha.6',
    agent_harness_id: 'codex-cli',
    running_location: 'local',
  });
  assert.match(fetchCalls[0].body.agent_public_key, /^ssh-ed25519 /);
  assert.equal(fetchCalls[0].hasSignal, true);
  assert.deepEqual(result, {
    auth_mode: 'agent_identity',
    agent_identity: {
      agent_runtime_id: 'agent-runtime-123',
      agent_private_key: Buffer.from(privateKeyBytes).toString('base64'),
      account_id: 'account-123',
      chatgpt_user_id: 'chatgpt-user',
      email: 'owner@example.com',
      plan_type: 'team',
      chatgpt_account_is_fedramp: false,
    },
  });
  assert.equal(JSON.stringify(result).includes(accessToken), false);
});

test('Agent Identity exposes explicit Web Crypto, Ed25519, response, and timeout errors safely', async (t) => {
  const api = loadAgentIdentityApi();
  const accessToken = createJwtToken({
    sub: 'subject-user',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'account-123',
    },
  });
  const privateKeyBytes = Uint8Array.from([1, 2, 3, 4]);
  const privateKeyBase64 = Buffer.from(privateKeyBytes).toString('base64');
  const workingCrypto = {
    subtle: {
      async generateKey() {
        return { privateKey: {}, publicKey: {} };
      },
      async exportKey(format) {
        return format === 'pkcs8'
          ? privateKeyBytes.buffer
          : Uint8Array.from({ length: 32 }, () => 9).buffer;
      },
    },
  };

  await t.test('Web Crypto unavailable', async () => {
    await assert.rejects(
      () => api.createAgentIdentity(accessToken, {}, { cryptoImpl: null, fetchImpl: async () => {} }),
      /Web Crypto/
    );
  });

  await t.test('Ed25519 unavailable', async () => {
    await assert.rejects(
      () => api.createAgentIdentity(accessToken, {}, {
        cryptoImpl: {
          subtle: {
            async generateKey() {
              throw new Error('unsupported algorithm');
            },
          },
        },
        fetchImpl: async () => {},
      }),
      /Ed25519/
    );
  });

  await t.test('non-2xx response is redacted', async () => {
    await assert.rejects(
      () => api.createAgentIdentity(accessToken, {}, {
        cryptoImpl: workingCrypto,
        fetchImpl: async () => createJsonResponse({
          message: `rejected Bearer ${accessToken}; private=${privateKeyBase64}`,
        }, 403),
      }),
      (error) => {
        assert.match(error.message, /HTTP 403/);
        assert.equal(error.message.includes(accessToken), false);
        assert.equal(error.message.includes(privateKeyBase64), false);
        return true;
      }
    );
  });

  await t.test('missing runtime id', async () => {
    await assert.rejects(
      () => api.createAgentIdentity(accessToken, {}, {
        cryptoImpl: workingCrypto,
        fetchImpl: async () => createJsonResponse({}),
      }),
      /agent_runtime_id/
    );
  });

  await t.test('request timeout', async () => {
    await assert.rejects(
      () => api.createAgentIdentity(accessToken, {}, {
        cryptoImpl: workingCrypto,
        fetchImpl: async (_url, options = {}) => await new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
        setTimeoutImpl(callback) {
          queueMicrotask(callback);
          return 1;
        },
        clearTimeoutImpl() {},
      }),
      /请求超时/
    );
  });
});
