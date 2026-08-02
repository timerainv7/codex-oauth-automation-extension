(function attachBackgroundOpenAiPublisherWebchat(root, factory) {
  root.MultiPageBackgroundOpenAiPublisherWebchat = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundOpenAiPublisherWebchatModule() {
  const WEBCHAT_INJECT_PATH = '/api/remote-account/inject';
  const WEBCHAT_GPT_PROVIDER_ID = 'gpt';
  const DEFAULT_SOURCE_ID = 'flowpilot-openai-session';
  const DEFAULT_SOURCE_NAME = 'FlowPilot OpenAI Session';

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function cleanString(value = '') {
    return String(value ?? '').trim();
  }

  function getErrorMessage(error) {
    return error instanceof Error ? error.message : cleanString(error) || '未知错误';
  }

  async function readResponse(response) {
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_error) {
      json = null;
    }
    return { text, json };
  }

  function readWebchatDetailMessage(detail) {
    if (Array.isArray(detail)) {
      return cleanString(detail.map((item) => {
        if (isPlainObject(item)) {
          const loc = Array.isArray(item.loc)
            ? item.loc.map((part) => cleanString(part)).filter((part) => part && part !== 'body').join('.')
            : cleanString(item.loc);
          const message = cleanString(item.msg || item.message || item.error || item.type);
          return [loc, message].filter(Boolean).join(': ');
        }
        return cleanString(item);
      }).filter(Boolean).join('; '));
    }
    if (isPlainObject(detail)) {
      const error = detail.error;
      return cleanString(
        (isPlainObject(error) ? error.message : error)
        || detail.message
        || detail.msg
      );
    }
    return cleanString(detail);
  }

  function readWebchatResponseMessage(body = {}, fallback = '') {
    const error = body?.json?.error;
    return cleanString(
      (isPlainObject(error) ? error.message : error)
      || body?.json?.message
      || readWebchatDetailMessage(body?.json?.detail)
      || fallback
    );
  }

  function normalizeWebchatBaseUrl(value = '') {
    const rawUrl = cleanString(value);
    if (!rawUrl) {
      throw new Error('缺少 webchat 地址。');
    }
    const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`;
    let parsed = null;
    try {
      parsed = new URL(withProtocol);
    } catch (_error) {
      throw new Error('webchat 地址格式无效，请检查配置。');
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new Error('webchat 地址只支持 http 或 https。');
    }
    return parsed.origin;
  }

  function buildWebchatInjectUrl(value = '') {
    return `${normalizeWebchatBaseUrl(value)}${WEBCHAT_INJECT_PATH}`;
  }

  function normalizeWebchatAdminKey(value = '') {
    return cleanString(value);
  }

  function resolveOpenAiWebchatConfig(state = {}) {
    const nestedConfig = state?.settingsState?.flows?.openai?.targets?.webchat || {};
    const grokNestedConfig = state?.settingsState?.flows?.grok?.targets?.webchat2api || {};
    return {
      baseUrl: cleanString(
        nestedConfig.baseUrl
        || grokNestedConfig.baseUrl
        || state?.openaiWebchatUrl
        || state?.grokWebchat2ApiUrl
      ),
      apiKey: normalizeWebchatAdminKey(
        nestedConfig.apiKey
        ?? grokNestedConfig.apiKey
        ?? state?.openaiWebchatAdminKey
        ?? state?.grokWebchat2ApiAdminKey
        ?? ''
      ),
    };
  }

  function buildOpenAiSessionInjectPayload(session = null, accessToken = '') {
    const token = cleanString(accessToken || session?.access_token || session?.accessToken);
    if (!token) {
      throw new Error('缺少 ChatGPT 会话或 accessToken。');
    }
    return {
      accounts: [{
        provider: WEBCHAT_GPT_PROVIDER_ID,
        access_token: token,
      }],
      strategy: 'merge',
      source_id: DEFAULT_SOURCE_ID,
      source_name: DEFAULT_SOURCE_NAME,
      provider: WEBCHAT_GPT_PROVIDER_ID,
    };
  }

  async function uploadOpenAiSessionToWebchat(baseUrl, apiKey, sessionState = {}, fetchImpl) {
    const endpointUrl = buildWebchatInjectUrl(baseUrl);
    const normalizedApiKey = normalizeWebchatAdminKey(apiKey);
    if (!normalizedApiKey) {
      throw new Error('缺少 webchat Admin Key。');
    }

    const response = await fetchImpl(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${normalizedApiKey}`,
      },
      body: JSON.stringify(buildOpenAiSessionInjectPayload(
        isPlainObject(sessionState?.session) ? sessionState.session : null,
        sessionState?.accessToken
      )),
    });
    const body = await readResponse(response);
    if (!response.ok) {
      const message = readWebchatResponseMessage(body, response.statusText) || `HTTP ${response.status}`;
      throw new Error(`webchat 会话上传失败：${message}`);
    }
    if (isPlainObject(body.json) && Object.prototype.hasOwnProperty.call(body.json, 'code') && Number(body.json.code) !== 0) {
      const message = readWebchatResponseMessage(body, `code=${body.json.code}`);
      throw new Error(`webchat 会话上传失败：${message}`);
    }
    return {
      endpointUrl,
      message: readWebchatResponseMessage(body, '') || '上传成功',
      raw: body.json,
    };
  }

  function createOpenAiWebchatPublisher(deps = {}) {
    const {
      addLog = async () => {},
      broadcastDataUpdate = null,
      completeNodeFromBackground,
      fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
      getStepIdByKeyForState = null,
      getState = async () => ({}),
      setState = async () => {},
    } = deps;

    if (typeof completeNodeFromBackground !== 'function') {
      throw new Error('OpenAI webchat publisher requires completeNodeFromBackground.');
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('OpenAI webchat publisher requires fetch support.');
    }

    let sessionReader = null;

    function getSessionReader() {
      if (sessionReader) {
        return sessionReader;
      }
      const factory = deps.createOpenAiSessionReader
        || self.MultiPageBackgroundOpenAiSessionReader?.createOpenAiSessionReader;
      if (typeof factory !== 'function') {
        throw new Error('OpenAI 会话读取模块未加载，无法上传当前 ChatGPT 会话。');
      }
      sessionReader = factory(deps);
      return sessionReader;
    }

    async function log(message, level = 'info', nodeId = '') {
      await addLog(message, level, nodeId ? { nodeId } : {});
    }

    async function setUploadState(patch = {}) {
      const updates = {
        openaiWebchatUploadStatus: cleanString(patch.status),
        openaiWebchatUploadedAt: Math.max(0, Number(patch.uploadedAt) || 0),
        openaiWebchatUploadMessage: cleanString(patch.message),
        openaiWebchatTargetUrl: cleanString(patch.targetUrl),
      };
      await setState(updates);
      if (typeof broadcastDataUpdate === 'function') {
        broadcastDataUpdate(updates);
      }
      return updates;
    }

    function resolveVisibleStep(state = {}, stepKey = '') {
      const visibleStep = Math.floor(Number(state?.visibleStep) || 0);
      if (visibleStep > 0) {
        return visibleStep;
      }
      const resolvedStep = typeof getStepIdByKeyForState === 'function'
        ? Math.floor(Number(getStepIdByKeyForState(stepKey, state)) || 0)
        : 0;
      if (resolvedStep > 0) {
        return resolvedStep;
      }
      throw new Error(`无法解析 ${stepKey || 'OpenAI webchat 交付节点'} 的当前步骤，请检查 workflow 装配。`);
    }

    async function executeOpenAiUploadSessionToWebchat(state = {}) {
      const nodeId = cleanString(state?.nodeId) || 'openai-upload-session-to-webchat';
      const visibleStep = resolveVisibleStep(state, nodeId);
      const currentState = await getState();
      let failureTargetUrl = '';
      try {
        const targetConfig = resolveOpenAiWebchatConfig(currentState);
        const endpointUrl = buildWebchatInjectUrl(targetConfig.baseUrl);
        failureTargetUrl = endpointUrl;
        const apiKey = normalizeWebchatAdminKey(targetConfig.apiKey);
        if (!apiKey) {
          throw new Error('缺少 webchat Admin Key。');
        }

        await setUploadState({
          status: 'reading_session',
          uploadedAt: 0,
          message: '',
          targetUrl: endpointUrl,
        });
        await log(`步骤 ${visibleStep}：正在读取当前 ChatGPT 会话，准备上传到 webchat...`, 'info', nodeId);
        const sessionState = await getSessionReader().readCurrentSessionFromState(currentState, {
          visibleStep,
          targetLabel: 'webchat',
          requiredFields: ['session'],
        });

        await setUploadState({
          status: 'uploading',
          uploadedAt: 0,
          message: '',
          targetUrl: endpointUrl,
        });
        await log(`步骤 ${visibleStep}：正在上传 ChatGPT 会话到 webchat...`, 'info', nodeId);
        const uploadResult = await uploadOpenAiSessionToWebchat(
          targetConfig.baseUrl,
          apiKey,
          sessionState,
          fetchImpl
        );
        const payload = await setUploadState({
          status: 'uploaded',
          uploadedAt: Date.now(),
          message: uploadResult.message || '上传成功',
          targetUrl: uploadResult.endpointUrl,
        });
        await log(`步骤 ${visibleStep}：ChatGPT 会话已上传到 webchat，状态：${uploadResult.message || '上传成功'}。`, 'ok', nodeId);
        await completeNodeFromBackground(nodeId, payload);
      } catch (error) {
        const message = getErrorMessage(error);
        await setUploadState({
          status: 'error',
          uploadedAt: 0,
          message,
          targetUrl: failureTargetUrl,
        });
        await log(`步骤 ${visibleStep}：${message}`, 'error', nodeId);
        throw error;
      }
    }

    return {
      executeOpenAiUploadSessionToWebchat,
    };
  }

  return {
    buildOpenAiSessionInjectPayload,
    buildWebchatInjectUrl,
    createOpenAiWebchatPublisher,
    normalizeWebchatBaseUrl,
    uploadOpenAiSessionToWebchat,
  };
});
