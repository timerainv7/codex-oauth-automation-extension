const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

function loadCpaSessionImportModule() {
  const source = fs.readFileSync('flows/openai/background/steps/cpa-session-import.js', 'utf8');
  return new Function('self', `${source}; return self.MultiPageBackgroundCpaSessionImport;`)({});
}

test('CPA session import delegates session acquisition to the shared reader', async () => {
  const moduleApi = loadCpaSessionImportModule();
  const completed = [];
  const logs = [];
  const importedPayloads = [];
  const readerCalls = [];
  const stepResolutionCalls = [];

  const executor = moduleApi.createCpaSessionImportExecutor({
    addLog: async (message, level = 'info', options = {}) => {
      logs.push({ message, level, step: options.step, stepKey: options.stepKey });
    },
    completeNodeFromBackground: async (nodeId, payload) => {
      completed.push({ nodeId, payload });
    },
    createCpaApi: () => ({
      importCurrentChatGptSession: async (state, options) => {
        importedPayloads.push({ state, options });
        return {
          verifiedStatus: 'CPA 会话导入完成：flow@example.com',
          cpaImportedFileName: 'codex-flow@example.com-plus.json',
          cpaImportedEmail: 'flow@example.com',
        };
      },
    }),
    createOpenAiSessionReader: () => ({
      readCurrentSessionFromState: async (state, options) => {
        readerCalls.push({ state, options });
        return {
          session: {
            accessToken: 'session-access-token',
            expires: '2026-05-20T12:34:56.000Z',
            user: { email: 'flow@example.com' },
          },
          accessToken: 'session-access-token',
          tabId: 91,
        };
      },
    }),
    getStepIdByKeyForState: (stepKey, state) => {
      stepResolutionCalls.push({ stepKey, state });
      return 7;
    },
    throwIfStopped: () => {},
  });

  const state = {
    nodeId: 'cpa-session-import',
    vpsUrl: 'https://cpa.example.com/management.html#/oauth',
    vpsPassword: 'management-key',
  };
  await executor.executeCpaSessionImport(state);

  assert.deepEqual(stepResolutionCalls, [{ stepKey: 'cpa-session-import', state }]);
  assert.deepEqual(readerCalls, [{
    state,
    options: {
      visibleStep: 7,
      targetLabel: 'CPA',
      requiredFields: ['session'],
    },
  }]);
  assert.equal(importedPayloads.length, 1);
  assert.equal(importedPayloads[0].state.accessToken, 'session-access-token');
  assert.equal(importedPayloads[0].state.session.user.email, 'flow@example.com');
  assert.deepEqual(completed, [{
    nodeId: 'cpa-session-import',
    payload: {
      verifiedStatus: 'CPA 会话导入完成：flow@example.com',
      cpaImportedFileName: 'codex-flow@example.com-plus.json',
      cpaImportedEmail: 'flow@example.com',
    },
  }]);
  assert.equal(
    logs.some((entry) => entry.stepKey === 'cpa-session-import' && /ChatGPT/.test(entry.message)),
    true
  );
});

test('background wires CPA session import executor into the workflow runtime', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /background\/cpa-api\.js/);
  assert.match(source, /background\/steps\/cpa-session-import\.js/);
  assert.match(source, /'cpa-session-import': \(state\) => cpaSessionImportExecutor\.executeCpaSessionImport\(state\)/);
  assert.match(source, /'cpa-session-import',[\s\S]*'oauth-login'/);
});
