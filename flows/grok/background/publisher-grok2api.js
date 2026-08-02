(function attachBackgroundGrokPublisherGrok2Api(root, factory) {
  root.MultiPageBackgroundGrokPublisherGrok2Api = factory(root);
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundGrokPublisherGrok2ApiModule(root) {
  const grokStateApi = root?.MultiPageBackgroundGrokState || null;
  const GROK2API_TOKENS_PATH = '/admin/api/tokens/add';
  const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function cloneValue(value) {
    if (Array.isArray(value)) {
      return value.map((entry) => cloneValue(entry));
    }
    if (isPlainObject(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, entryValue]) => [key, cloneValue(entryValue)])
      );
    }
    return value;
  }

  function deepMerge(baseValue, patchValue) {
    if (Array.isArray(patchValue)) {
      return patchValue.map((entry) => cloneValue(entry));
    }
    if (!isPlainObject(patchValue)) {
      return patchValue === undefined ? cloneValue(baseValue) : patchValue;
    }

    const baseObject = isPlainObject(baseValue) ? baseValue : {};
    const next = {
      ...cloneValue(baseObject),
    };
    Object.entries(patchValue).forEach(([key, value]) => {
      next[key] = deepMerge(baseObject[key], value);
    });
    return next;
  }

  function cleanString(value = '') {
    return String(value ?? '').trim();
  }

  function getErrorMessage(error) {
    return error instanceof Error ? error.message : cleanString(error) || '未知错误';
  }

  function sanitizeSensitiveMessage(value = '', sensitiveValues = []) {
    let message = cleanString(value).slice(0, 500);
    const secrets = Array.from(new Set(
      (Array.isArray(sensitiveValues) ? sensitiveValues : [])
        .map((entry) => cleanString(entry))
        .filter(Boolean)
        .sort((left, right) => right.length - left.length)
    ));
    secrets.forEach((secret) => {
      message = message.split(secret).join('[REDACTED]');
    });
    return message;
  }

  function formatErrorValue(value) {
    if (typeof value === 'string') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((entry) => formatErrorValue(entry)).filter(Boolean).join('; ');
    }
    if (isPlainObject(value)) {
      const nestedMessage = value.message || value.msg || value.error || value.detail;
      if (nestedMessage !== undefined) {
        return formatErrorValue(nestedMessage);
      }
      try {
        return JSON.stringify(value);
      } catch (_error) {
        return '';
      }
    }
    return cleanString(value);
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

  function readGrok2ApiErrorMessage(body = {}, fallback = '', sensitiveValues = []) {
    const rawMessage = body?.json?.detail
      ?? body?.json?.error?.message
      ?? body?.json?.error
      ?? body?.json?.message
      ?? body?.text
      ?? fallback;
    return sanitizeSensitiveMessage(formatErrorValue(rawMessage) || fallback, sensitiveValues);
  }

  function normalizeGrok2ApiBaseUrl(value = '') {
    const rawUrl = cleanString(value);
    if (!rawUrl) {
      throw new Error('缺少 grok2api 地址。');
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) && !/^https?:\/\//i.test(rawUrl)) {
      throw new Error('grok2api 地址只支持 http 或 https。');
    }
    const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`;
    let parsed = null;
    try {
      parsed = new URL(withProtocol);
    } catch (_error) {
      throw new Error('grok2api 地址格式无效，请检查配置。');
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new Error('grok2api 地址只支持 http 或 https。');
    }
    return parsed.origin;
  }

  function buildGrok2ApiTokensUrl(value = '') {
    return `${normalizeGrok2ApiBaseUrl(value)}${GROK2API_TOKENS_PATH}`;
  }

  function normalizeGrok2ApiAdminKey(value = '') {
    return cleanString(value);
  }

  function readGrokRuntime(state = {}) {
    return grokStateApi?.ensureRuntimeState
      ? grokStateApi.ensureRuntimeState(state)
      : (isPlainObject(state?.runtimeState?.flowState?.grok)
        ? state.runtimeState.flowState.grok
        : (isPlainObject(state?.flowState?.grok) ? state.flowState.grok : {}));
  }

  function buildCanonicalRuntimePatch(currentState = {}, nextRuntimeState = {}) {
    if (typeof grokStateApi?.buildRuntimeStatePatch === 'function') {
      return grokStateApi.buildRuntimeStatePatch(currentState, nextRuntimeState);
    }
    const baseRuntimeState = isPlainObject(currentState?.runtimeState)
      ? cloneValue(currentState.runtimeState)
      : {};
    const baseFlowState = isPlainObject(baseRuntimeState.flowState)
      ? cloneValue(baseRuntimeState.flowState)
      : {};
    return {
      runtimeState: {
        ...baseRuntimeState,
        flowState: {
          ...baseFlowState,
          grok: deepMerge(readGrokRuntime(currentState), nextRuntimeState),
        },
      },
    };
  }

  function mergeRuntimePatch(currentState = {}, patch = {}) {
    return buildCanonicalRuntimePatch(
      currentState,
      deepMerge(readGrokRuntime(currentState), patch)
    );
  }

  function resolveGrok2ApiConfig(state = {}) {
    const nestedConfig = state?.settingsState?.flows?.grok?.targets?.grok2api || {};
    return {
      baseUrl: cleanString(nestedConfig.baseUrl || state?.grok2ApiUrl),
      apiKey: normalizeGrok2ApiAdminKey(nestedConfig.apiKey ?? state?.grok2ApiAdminKey ?? ''),
    };
  }

  function resolveGrokSsoCookie(state = {}) {
    const runtimeState = readGrokRuntime(state);
    return cleanString(runtimeState?.sso?.currentCookie || state?.grokSsoCookie);
  }

  function buildGrok2ApiTokensPayload(ssoCookie = '') {
    const normalizedCookie = cleanString(ssoCookie);
    if (!normalizedCookie) {
      throw new Error('缺少 Grok SSO Cookie，请先完成 SSO 提取步骤。');
    }
    return {
      tokens: [normalizedCookie],
      pool: 'auto',
    };
  }

  async function uploadGrokSsoToGrok2Api(baseUrl, apiKey, ssoCookie, fetchImpl, options = {}) {
    const endpointUrl = buildGrok2ApiTokensUrl(baseUrl);
    const normalizedApiKey = normalizeGrok2ApiAdminKey(apiKey);
    if (!normalizedApiKey) {
      throw new Error('缺少 grok2api Admin Key。');
    }
    const payload = buildGrok2ApiTokensPayload(ssoCookie);
    const normalizedSsoCookie = payload.tokens[0];
    const sensitiveValues = [normalizedApiKey, normalizedSsoCookie];
    const timeoutMs = Math.max(1, Number(options?.timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let response = null;
    try {
      response = await fetchImpl(endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${normalizedApiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`grok2api 上传超时（${Math.ceil(timeoutMs / 1000)} 秒）。`);
      }
      const message = sanitizeSensitiveMessage(getErrorMessage(error), sensitiveValues);
      throw new Error(`grok2api SSO 上传失败：${message}`);
    } finally {
      clearTimeout(timeoutId);
    }

    const body = await readResponse(response);
    if (!response.ok) {
      const message = readGrok2ApiErrorMessage(
        body,
        response.statusText || `HTTP ${response.status}`,
        sensitiveValues
      );
      throw new Error(`grok2api SSO 上传失败：${message}`);
    }
    if (!isPlainObject(body.json)) {
      throw new Error('grok2api SSO 上传失败：服务端返回了无效响应。');
    }

    const count = Math.max(0, Number(body.json.count) || 0);
    const skipped = Math.max(0, Number(body.json.skipped) || 0);
    if (body.json.status !== 'success') {
      const message = readGrok2ApiErrorMessage(body, '服务端未返回成功状态。', sensitiveValues);
      throw new Error(`grok2api SSO 上传失败：${message}`);
    }
    if (count + skipped < 1) {
      throw new Error('grok2api SSO 上传失败：服务端未新增或跳过任何账号。');
    }

    return {
      endpointUrl,
      count,
      skipped,
      message: `新增 ${count} 个，跳过 ${skipped} 个`,
    };
  }

  function createGrok2ApiPublisher(deps = {}) {
    const {
      addLog = async () => {},
      completeNodeFromBackground,
      fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
      getState = async () => ({}),
      setState = async () => {},
    } = deps;

    if (typeof completeNodeFromBackground !== 'function') {
      throw new Error('Grok2API publisher requires completeNodeFromBackground.');
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('Grok2API publisher requires fetch support.');
    }

    async function log(message, level = 'info', nodeId = '') {
      await addLog(message, level, nodeId ? { nodeId } : {});
    }

    async function applyRuntimeState(currentState = {}, patch = {}) {
      const nextPatch = mergeRuntimePatch(currentState, patch);
      await setState(nextPatch);
      return nextPatch;
    }

    async function persistFailure(currentState = {}, message = '', targetUrl = '') {
      const uploadPatch = {
        targetId: 'grok2api',
        status: 'error',
        uploadedAt: 0,
        message,
      };
      const normalizedTargetUrl = cleanString(targetUrl);
      if (normalizedTargetUrl) {
        uploadPatch.targetUrl = normalizedTargetUrl;
      }
      await setState(mergeRuntimePatch(currentState, {
        session: {
          lastError: message,
        },
        upload: uploadPatch,
      }));
    }

    async function executeGrokUploadSsoToGrok2Api(state = {}) {
      const nodeId = cleanString(state?.nodeId) || 'grok-upload-sso-to-grok2api';
      const currentState = await getState();
      let failureTargetUrl = '';
      try {
        const targetConfig = resolveGrok2ApiConfig(currentState);
        const endpointUrl = buildGrok2ApiTokensUrl(targetConfig.baseUrl);
        failureTargetUrl = endpointUrl;
        const apiKey = normalizeGrok2ApiAdminKey(targetConfig.apiKey);
        if (!apiKey) {
          throw new Error('缺少 grok2api Admin Key。');
        }
        const ssoCookie = resolveGrokSsoCookie(currentState);
        if (!ssoCookie) {
          throw new Error('缺少 Grok SSO Cookie，请先完成 SSO 提取步骤。');
        }

        await applyRuntimeState(currentState, {
          session: {
            lastError: '',
          },
          upload: {
            targetId: 'grok2api',
            status: 'uploading',
            uploadedAt: 0,
            message: '',
            targetUrl: endpointUrl,
          },
        });

        await log('正在上传 Grok SSO 到 grok2api...', 'info', nodeId);
        const uploadResult = await uploadGrokSsoToGrok2Api(
          targetConfig.baseUrl,
          apiKey,
          ssoCookie,
          fetchImpl
        );
        const payload = await applyRuntimeState(currentState, {
          session: {
            lastError: '',
          },
          upload: {
            targetId: 'grok2api',
            status: 'uploaded',
            uploadedAt: Date.now(),
            message: uploadResult.message,
            targetUrl: uploadResult.endpointUrl,
          },
        });
        await log(`Grok SSO 已上传到 grok2api，${uploadResult.message}。`, 'ok', nodeId);
        await completeNodeFromBackground(nodeId, payload);
      } catch (error) {
        const targetConfig = resolveGrok2ApiConfig(currentState);
        const message = sanitizeSensitiveMessage(getErrorMessage(error), [
          targetConfig.apiKey,
          resolveGrokSsoCookie(currentState),
        ]);
        await persistFailure(currentState, message, failureTargetUrl);
        await log(message, 'error', nodeId);
        throw new Error(message);
      }
    }

    return {
      executeGrokUploadSsoToGrok2Api,
    };
  }

  return {
    buildGrok2ApiTokensPayload,
    buildGrok2ApiTokensUrl,
    createGrok2ApiPublisher,
    normalizeGrok2ApiBaseUrl,
    sanitizeSensitiveMessage,
    uploadGrokSsoToGrok2Api,
  };
});
