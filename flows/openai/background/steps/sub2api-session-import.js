(function attachBackgroundSub2ApiSessionImport(root, factory) {
  root.MultiPageBackgroundSub2ApiSessionImport = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundSub2ApiSessionImportModule() {
  function createSub2ApiSessionImportExecutor(deps = {}) {
    const {
      addLog: rawAddLog = async () => {},
      completeNodeFromBackground,
      getStepIdByKeyForState = null,
      normalizeSub2ApiUrl = (value) => value,
      throwIfStopped = () => {},
      DEFAULT_SUB2API_GROUP_NAME = 'codex',
    } = deps;

    let sub2ApiApi = null;
    let sessionReader = null;

    function addStepLog(step, message, level = 'info') {
      return rawAddLog(message, level, {
        step,
        stepKey: 'sub2api-session-import',
      });
    }

    function getSub2ApiApi() {
      if (sub2ApiApi) {
        return sub2ApiApi;
      }
      const factory = deps.createSub2ApiApi
        || self.MultiPageBackgroundSub2ApiApi?.createSub2ApiApi;
      if (typeof factory !== 'function') {
        throw new Error('SUB2API 接口模块未加载，无法导入当前 ChatGPT 会话。');
      }
      sub2ApiApi = factory({
        addLog: rawAddLog,
        normalizeSub2ApiUrl,
        DEFAULT_SUB2API_GROUP_NAME,
      });
      return sub2ApiApi;
    }

    function getSessionReader() {
      if (sessionReader) {
        return sessionReader;
      }
      const factory = deps.createOpenAiSessionReader
        || self.MultiPageBackgroundOpenAiSessionReader?.createOpenAiSessionReader;
      if (typeof factory !== 'function') {
        throw new Error('OpenAI 会话读取模块未加载，无法导入当前会话到 SUB2API。');
      }
      sessionReader = factory(deps);
      return sessionReader;
    }

    function resolveVisibleStep(state = {}) {
      const visibleStep = Math.floor(Number(state?.visibleStep) || 0);
      if (visibleStep > 0) {
        return visibleStep;
      }
      const resolvedStep = typeof getStepIdByKeyForState === 'function'
        ? Math.floor(Number(getStepIdByKeyForState('sub2api-session-import', state)) || 0)
        : 0;
      if (resolvedStep > 0) {
        return resolvedStep;
      }
      throw new Error('无法解析 SUB2API Session 交付节点的当前步骤，请检查 workflow 装配。');
    }

    async function executeSub2ApiSessionImport(state = {}) {
      throwIfStopped();
      const visibleStep = resolveVisibleStep(state);
      const api = getSub2ApiApi();

      await addStepLog(visibleStep, '正在读取当前 ChatGPT 登录会话并准备导入 SUB2API...', 'info');
      const sessionState = await getSessionReader().readCurrentSessionFromState(state, {
        visibleStep,
        targetLabel: 'SUB2API',
        requiredFields: ['session'],
      });
      throwIfStopped();

      const result = await api.importCurrentChatGptSession({
        ...state,
        session: sessionState.session,
        accessToken: sessionState.accessToken,
      }, {
        visibleStep,
        logLabel: `步骤 ${visibleStep}`,
        logOptions: { step: visibleStep, stepKey: 'sub2api-session-import' },
        timeoutMs: 120000,
      });

      await completeNodeFromBackground(state?.nodeId || 'sub2api-session-import', result);
    }

    return {
      executeSub2ApiSessionImport,
    };
  }

  return {
    createSub2ApiSessionImportExecutor,
  };
});
