const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadStepApi() {
  const source = fs.readFileSync('flows/openai/background/steps/sub2api-agent-identity-import.js', 'utf8');
  const globalScope = {};
  new Function('self', `${source}; return self;`)(globalScope);
  return globalScope.MultiPageBackgroundSub2ApiAgentIdentityImport;
}

function createAuthJson(overrides = {}) {
  return {
    auth_mode: 'agent_identity',
    agent_identity: {
      agent_runtime_id: 'agent-runtime-123',
      agent_private_key: 'private-key-base64',
      account_id: 'account-123',
      chatgpt_user_id: 'user-123',
      email: 'owner@example.com',
      plan_type: 'plus',
      chatgpt_account_is_fedramp: false,
      ...overrides,
    },
  };
}

test('SUB2API Agent Identity step preflights before reading and registering, then completes safely', async () => {
  const api = loadStepApi();
  const events = [];
  const readerCalls = [];
  const importCalls = [];
  const completed = [];
  const logs = [];
  const stepResolutionCalls = [];
  const authJson = createAuthJson();
  const prepared = {
    origin: 'https://sub.example',
    token: 'admin-token',
    groupIds: [5],
    proxyId: 7,
    accountPriority: 2,
  };

  const executor = api.createSub2ApiAgentIdentityImportExecutor({
    addLog: async (message, level, options) => logs.push({ message, level, options }),
    completeNodeFromBackground: async (nodeId, payload) => {
      events.push('complete');
      completed.push({ nodeId, payload });
    },
    createAgentIdentity: async (accessToken, session) => {
      events.push('register-agent');
      assert.equal(accessToken, 'live-access-token');
      assert.equal(session.user.email, 'owner@example.com');
      return authJson;
    },
    createOpenAiSessionReader: () => ({
      readCurrentSessionFromState: async (state, options) => {
        events.push('read-session');
        readerCalls.push({ state, options });
        return {
          accessToken: 'live-access-token',
          session: { user: { email: 'owner@example.com' } },
        };
      },
    }),
    createSub2ApiApi: () => ({
      prepareCodexSessionImport: async (state, options) => {
        events.push('preflight');
        assert.equal(state.sub2apiGroupName, 'codex');
        assert.equal(options.logOptions.stepKey, 'sub2api-agent-identity-import');
        return prepared;
      },
      importPreparedCodexAuth: async (actualPrepared, input, options) => {
        events.push('import');
        importCalls.push({ actualPrepared, input, options });
        return {
          verifiedStatus: 'SUB2API Agent Identity 导入完成：新建 1，更新 0，跳过 0，失败 0',
          sub2apiImportCreated: 1,
          sub2apiImportUpdated: 0,
          sub2apiImportSkipped: 0,
          sub2apiImportFailed: 0,
        };
      },
    }),
    getStepIdByKeyForState: (stepKey, state) => {
      stepResolutionCalls.push({ stepKey, state });
      return 7;
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });

  const state = {
    nodeId: 'sub2api-agent-identity-import',
    sub2apiUrl: 'https://sub.example/admin/accounts',
    sub2apiEmail: 'admin@example.com',
    sub2apiPassword: 'secret',
    sub2apiGroupName: 'codex',
  };
  await executor.executeSub2ApiAgentIdentityImport(state);

  assert.deepEqual(events, ['preflight', 'read-session', 'register-agent', 'import', 'complete']);
  assert.deepEqual(stepResolutionCalls, [{ stepKey: 'sub2api-agent-identity-import', state }]);
  assert.deepEqual(readerCalls, [{
    state,
    options: {
      visibleStep: 7,
      targetLabel: 'SUB2API Agent Identity',
      requiredFields: ['accessToken'],
    },
  }]);
  assert.equal(importCalls.length, 1);
  assert.strictEqual(importCalls[0].actualPrepared, prepared);
  assert.strictEqual(importCalls[0].input.authJson, authJson);
  assert.equal(importCalls[0].input.accountName, 'owner@example.com');
  assert.equal(importCalls[0].input.expiresAt, null);
  assert.equal(importCalls[0].options.resultLabel, 'SUB2API Agent Identity 导入完成');
  assert.deepEqual(completed, [{
    nodeId: 'sub2api-agent-identity-import',
    payload: {
      verifiedStatus: 'SUB2API Agent Identity 导入完成：新建 1，更新 0，跳过 0，失败 0',
      sub2apiImportCreated: 1,
      sub2apiImportUpdated: 0,
      sub2apiImportSkipped: 0,
      sub2apiImportFailed: 0,
    },
  }]);
  const serializedLogs = JSON.stringify(logs);
  assert.equal(serializedLogs.includes('live-access-token'), false);
  assert.equal(serializedLogs.includes('private-key-base64'), false);
  assert.equal(serializedLogs.includes(JSON.stringify(authJson)), false);
});

test('SUB2API Agent Identity step retries only the import with the same in-memory auth.json', async () => {
  const api = loadStepApi();
  const authJson = createAuthJson();
  const prepared = { origin: 'https://sub.example', token: 'admin-token', groupIds: [5] };
  const importCalls = [];
  const sleepCalls = [];
  let prepareCount = 0;
  let readCount = 0;
  let registerCount = 0;

  const executor = api.createSub2ApiAgentIdentityImportExecutor({
    addLog: async () => {},
    completeNodeFromBackground: async () => {},
    createAgentIdentity: async () => {
      registerCount += 1;
      return authJson;
    },
    createOpenAiSessionReader: () => ({
      readCurrentSessionFromState: async () => {
        readCount += 1;
        return {
          accessToken: 'live-access-token',
          session: { user: { email: 'owner@example.com' } },
        };
      },
    }),
    createSub2ApiApi: () => ({
      prepareCodexSessionImport: async () => {
        prepareCount += 1;
        return prepared;
      },
      importPreparedCodexAuth: async (actualPrepared, input) => {
        importCalls.push({ actualPrepared, input });
        if (importCalls.length === 1) {
          const error = new Error('temporarily unavailable');
          error.status = 503;
          throw error;
        }
        return {
          verifiedStatus: 'SUB2API Agent Identity 导入完成：新建 1，更新 0，跳过 0，失败 0',
        };
      },
    }),
    sleepWithStop: async (duration) => sleepCalls.push(duration),
    throwIfStopped: () => {},
  });

  await executor.executeSub2ApiAgentIdentityImport({
    nodeId: 'sub2api-agent-identity-import',
    visibleStep: 10,
  });

  assert.equal(prepareCount, 1);
  assert.equal(readCount, 1);
  assert.equal(registerCount, 1);
  assert.equal(importCalls.length, 2);
  assert.strictEqual(importCalls[0].actualPrepared, prepared);
  assert.strictEqual(importCalls[1].actualPrepared, prepared);
  assert.strictEqual(importCalls[0].input.authJson, authJson);
  assert.strictEqual(importCalls[1].input.authJson, authJson);
  assert.equal(importCalls[0].input.authJson.agent_identity.agent_runtime_id, 'agent-runtime-123');
  assert.equal(importCalls[1].input.authJson.agent_identity.agent_runtime_id, 'agent-runtime-123');
  assert.deepEqual(sleepCalls, [10000]);
});

test('SUB2API Agent Identity step retries the documented transient import failures', async (t) => {
  const cases = [
    { name: 'HTTP 408', createError: () => Object.assign(new Error('request timeout'), { status: 408 }) },
    { name: 'HTTP 429', createError: () => Object.assign(new Error('rate limited'), { status: 429 }) },
    { name: 'HTTP 500', createError: () => Object.assign(new Error('server error'), { status: 500 }) },
    { name: 'HTTP 599', createError: () => Object.assign(new Error('gateway error'), { status: 599 }) },
    { name: 'request timeout', createError: () => Object.assign(new Error('SUB2API request timed out'), { code: 'SUB2API_TIMEOUT' }) },
    { name: 'network failure', createError: () => Object.assign(new TypeError('fetch failed'), { isNetworkError: true }) },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      let importCount = 0;
      let sleepCount = 0;
      const api = loadStepApi();
      const executor = api.createSub2ApiAgentIdentityImportExecutor({
        addLog: async () => {},
        completeNodeFromBackground: async () => {},
        createAgentIdentity: async () => createAuthJson(),
        createOpenAiSessionReader: () => ({
          readCurrentSessionFromState: async () => ({
            accessToken: 'live-access-token',
            session: { user: { email: 'owner@example.com' } },
          }),
        }),
        createSub2ApiApi: () => ({
          prepareCodexSessionImport: async () => ({ groupIds: [5] }),
          importPreparedCodexAuth: async () => {
            importCount += 1;
            if (importCount === 1) {
              throw testCase.createError();
            }
            return { verifiedStatus: 'imported' };
          },
        }),
        sleepWithStop: async (duration) => {
          assert.equal(duration, 10000);
          sleepCount += 1;
        },
        throwIfStopped: () => {},
      });

      await executor.executeSub2ApiAgentIdentityImport({ visibleStep: 10 });
      assert.equal(importCount, 2);
      assert.equal(sleepCount, 1);
    });
  }
});

test('SUB2API Agent Identity step retries a transient preflight before reading the ChatGPT session', async () => {
  const api = loadStepApi();
  const sleepCalls = [];
  let prepareCount = 0;
  let readCount = 0;
  let registerCount = 0;
  let importCount = 0;
  const executor = api.createSub2ApiAgentIdentityImportExecutor({
    addLog: async () => {},
    completeNodeFromBackground: async () => {},
    createAgentIdentity: async () => {
      registerCount += 1;
      return createAuthJson();
    },
    createOpenAiSessionReader: () => ({
      readCurrentSessionFromState: async () => {
        readCount += 1;
        return { accessToken: 'live-access-token', session: {} };
      },
    }),
    createSub2ApiApi: () => ({
      prepareCodexSessionImport: async () => {
        prepareCount += 1;
        if (prepareCount < 3) {
          throw Object.assign(new Error('SUB2API request timed out'), { code: 'SUB2API_TIMEOUT' });
        }
        return { groupIds: [5] };
      },
      importPreparedCodexAuth: async () => {
        importCount += 1;
        return { verifiedStatus: 'imported' };
      },
    }),
    sleepWithStop: async (duration) => sleepCalls.push(duration),
    throwIfStopped: () => {},
  });

  await executor.executeSub2ApiAgentIdentityImport({ visibleStep: 10 });

  assert.equal(prepareCount, 3);
  assert.equal(readCount, 1);
  assert.equal(registerCount, 1);
  assert.equal(importCount, 1);
  assert.deepEqual(sleepCalls, [10000, 10000]);
});

test('SUB2API Agent Identity step stops retrying transient imports after five minutes', async () => {
  const api = loadStepApi();
  const sleepCalls = [];
  let nowMs = 0;
  let importCount = 0;
  const executor = api.createSub2ApiAgentIdentityImportExecutor({
    addLog: async () => {},
    completeNodeFromBackground: async () => {},
    createAgentIdentity: async () => createAuthJson(),
    createOpenAiSessionReader: () => ({
      readCurrentSessionFromState: async () => ({ accessToken: 'live-access-token', session: {} }),
    }),
    createSub2ApiApi: () => ({
      prepareCodexSessionImport: async () => ({ groupIds: [5] }),
      importPreparedCodexAuth: async () => {
        importCount += 1;
        throw Object.assign(new Error('temporarily unavailable'), { status: 503 });
      },
    }),
    now: () => nowMs,
    sleepWithStop: async (duration) => {
      sleepCalls.push(duration);
      nowMs += duration;
    },
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeSub2ApiAgentIdentityImport({ visibleStep: 10 }),
    /temporarily unavailable/
  );
  assert.equal(importCount, 31);
  assert.deepEqual(sleepCalls, Array(30).fill(10000));
});

test('SUB2API Agent Identity step does not retry non-transient import errors', async () => {
  const api = loadStepApi();
  let importCount = 0;
  const executor = api.createSub2ApiAgentIdentityImportExecutor({
    addLog: async () => {},
    completeNodeFromBackground: async () => {},
    createAgentIdentity: async () => createAuthJson(),
    createOpenAiSessionReader: () => ({
      readCurrentSessionFromState: async () => ({ accessToken: 'live-access-token', session: {} }),
    }),
    createSub2ApiApi: () => ({
      prepareCodexSessionImport: async () => ({ groupIds: [5] }),
      importPreparedCodexAuth: async () => {
        importCount += 1;
        const error = new Error('invalid import payload');
        error.status = 400;
        throw error;
      },
    }),
    sleepWithStop: async () => {
      throw new Error('must not sleep');
    },
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeSub2ApiAgentIdentityImport({ visibleStep: 10 }),
    /invalid import payload/
  );
  assert.equal(importCount, 1);
});

test('SUB2API Agent Identity step never reads or registers when SUB2API preflight fails', async () => {
  const api = loadStepApi();
  let readCount = 0;
  let registerCount = 0;
  let importCount = 0;
  const executor = api.createSub2ApiAgentIdentityImportExecutor({
    addLog: async () => {},
    completeNodeFromBackground: async () => {},
    createAgentIdentity: async () => {
      registerCount += 1;
      return createAuthJson();
    },
    createOpenAiSessionReader: () => ({
      readCurrentSessionFromState: async () => {
        readCount += 1;
        return { accessToken: 'live-access-token' };
      },
    }),
    createSub2ApiApi: () => ({
      prepareCodexSessionImport: async () => {
        throw new Error('SUB2API 目标分组不存在');
      },
      importPreparedCodexAuth: async () => {
        importCount += 1;
      },
    }),
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeSub2ApiAgentIdentityImport({ visibleStep: 10 }),
    /目标分组不存在/
  );
  assert.equal(readCount, 0);
  assert.equal(registerCount, 0);
  assert.equal(importCount, 0);
});

test('SUB2API Agent Identity step checks Stop immediately after irreversible registration', async () => {
  const api = loadStepApi();
  let stopped = false;
  let importCount = 0;
  const executor = api.createSub2ApiAgentIdentityImportExecutor({
    addLog: async () => {},
    completeNodeFromBackground: async () => {},
    createAgentIdentity: async () => {
      stopped = true;
      return createAuthJson();
    },
    createOpenAiSessionReader: () => ({
      readCurrentSessionFromState: async () => ({ accessToken: 'live-access-token', session: {} }),
    }),
    createSub2ApiApi: () => ({
      prepareCodexSessionImport: async () => ({ groupIds: [5] }),
      importPreparedCodexAuth: async () => {
        importCount += 1;
      },
    }),
    throwIfStopped: () => {
      if (stopped) {
        throw new Error('流程已被用户停止。');
      }
    },
  });

  await assert.rejects(
    () => executor.executeSub2ApiAgentIdentityImport({ visibleStep: 10 }),
    /流程已被用户停止/
  );
  assert.equal(importCount, 0);
});
