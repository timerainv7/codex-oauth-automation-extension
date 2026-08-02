(function attachMultiPageOpenAiAccountDelivery(root, factory) {
  root.MultiPageOpenAiAccountDelivery = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createOpenAiAccountDeliveryModule() {
  const ACCOUNT_DELIVERY_MODE_OAUTH = 'oauth';
  const ACCOUNT_DELIVERY_MODE_SESSION = 'session';
  const ACCOUNT_DELIVERY_MODE_AGENT_IDENTITY = 'agent_identity';
  const ACCOUNT_DELIVERY_MODE_IDS = Object.freeze([
    ACCOUNT_DELIVERY_MODE_OAUTH,
    ACCOUNT_DELIVERY_MODE_SESSION,
    ACCOUNT_DELIVERY_MODE_AGENT_IDENTITY,
  ]);
  const ACCOUNT_DELIVERY_MODE_ID_SET = new Set(ACCOUNT_DELIVERY_MODE_IDS);
  const ACCOUNT_DELIVERY_MODE_DEFINITIONS = Object.freeze({
    [ACCOUNT_DELIVERY_MODE_OAUTH]: Object.freeze({
      id: ACCOUNT_DELIVERY_MODE_OAUTH,
      label: 'OAuth',
      description: '通过目标平台 OAuth 授权交付账号',
    }),
    [ACCOUNT_DELIVERY_MODE_SESSION]: Object.freeze({
      id: ACCOUNT_DELIVERY_MODE_SESSION,
      label: 'ChatGPT Session',
      description: '读取当前 ChatGPT 登录会话并导入目标平台',
    }),
    [ACCOUNT_DELIVERY_MODE_AGENT_IDENTITY]: Object.freeze({
      id: ACCOUNT_DELIVERY_MODE_AGENT_IDENTITY,
      label: 'Agent Identity',
      description: '注册本地 Agent Identity 后导入目标平台',
    }),
  });

  function cleanModeId(value = '') {
    return String(value || '').trim().toLowerCase();
  }

  function isAccountDeliveryMode(value = '') {
    return ACCOUNT_DELIVERY_MODE_ID_SET.has(cleanModeId(value));
  }

  function normalizeAccountDeliveryMode(value = '', fallback = ACCOUNT_DELIVERY_MODE_OAUTH) {
    const normalized = cleanModeId(value);
    if (ACCOUNT_DELIVERY_MODE_ID_SET.has(normalized)) {
      return normalized;
    }
    const normalizedFallback = cleanModeId(fallback);
    return ACCOUNT_DELIVERY_MODE_ID_SET.has(normalizedFallback)
      ? normalizedFallback
      : ACCOUNT_DELIVERY_MODE_OAUTH;
  }

  function getAccountDeliveryModeDefinition(value = '') {
    return ACCOUNT_DELIVERY_MODE_DEFINITIONS[cleanModeId(value)] || null;
  }

  function getAccountDeliveryModeOptions(modeIds = ACCOUNT_DELIVERY_MODE_IDS) {
    const values = Array.isArray(modeIds) ? modeIds : ACCOUNT_DELIVERY_MODE_IDS;
    const seen = new Set();
    return values.reduce((options, value) => {
      const modeId = cleanModeId(value);
      const definition = ACCOUNT_DELIVERY_MODE_DEFINITIONS[modeId];
      if (!definition || seen.has(modeId)) {
        return options;
      }
      seen.add(modeId);
      options.push(definition);
      return options;
    }, []);
  }

  return {
    ACCOUNT_DELIVERY_MODE_AGENT_IDENTITY,
    ACCOUNT_DELIVERY_MODE_DEFINITIONS,
    ACCOUNT_DELIVERY_MODE_IDS,
    ACCOUNT_DELIVERY_MODE_OAUTH,
    ACCOUNT_DELIVERY_MODE_SESSION,
    getAccountDeliveryModeDefinition,
    getAccountDeliveryModeOptions,
    isAccountDeliveryMode,
    normalizeAccountDeliveryMode,
  };
});
