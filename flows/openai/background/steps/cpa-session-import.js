(function attachBackgroundCpaSessionImport(root, factory) {
  root.MultiPageBackgroundCpaSessionImport = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundCpaSessionImportModule() {
  function createCpaSessionImportExecutor(deps = {}) {
    const {
      addLog: rawAddLog = async () => {},
      completeNodeFromBackground,
      getStepIdByKeyForState = null,
      throwIfStopped = () => {},
    } = deps;

    let cpaApi = null;
    let sessionReader = null;

    function addStepLog(step, message, level = 'info') {
      return rawAddLog(message, level, {
        step,
        stepKey: 'cpa-session-import',
      });
    }

    function getCpaApi() {
      if (cpaApi) {
        return cpaApi;
      }
      const factory = deps.createCpaApi
        || self.MultiPageBackgroundCpaApi?.createCpaApi;
      if (typeof factory !== 'function') {
        throw new Error('CPA 接口模块未加载，无法导入当前 ChatGPT 会话。');
      }
      cpaApi = factory({
        addLog: rawAddLog,
      });
      return cpaApi;
    }

    function getSessionReader() {
      if (sessionReader) {
        return sessionReader;
      }
      const factory = deps.createOpenAiSessionReader
        || self.MultiPageBackgroundOpenAiSessionReader?.createOpenAiSessionReader;
      if (typeof factory !== 'function') {
        throw new Error('OpenAI 会话读取模块未加载，无法导入当前会话到 CPA。');
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
        ? Math.floor(Number(getStepIdByKeyForState('cpa-session-import', state)) || 0)
        : 0;
      if (resolvedStep > 0) {
        return resolvedStep;
      }
      throw new Error('无法解析 CPA Session 交付节点的当前步骤，请检查 workflow 装配。');
    }

    async function executeCpaSessionImport(state = {}) {
      throwIfStopped();
      const visibleStep = resolveVisibleStep(state);
      const api = getCpaApi();

      await addStepLog(visibleStep, '正在读取当前 ChatGPT 登录会话并准备导入 CPA...', 'info');
      const sessionState = await getSessionReader().readCurrentSessionFromState(state, {
        visibleStep,
        targetLabel: 'CPA',
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
        logOptions: { step: visibleStep, stepKey: 'cpa-session-import' },
        timeoutMs: 120000,
        importTimeoutMs: 120000,
      });

      await completeNodeFromBackground(state?.nodeId || 'cpa-session-import', result);
    }

    return {
      executeCpaSessionImport,
    };
  }

  return {
    createCpaSessionImportExecutor,
  };
});
