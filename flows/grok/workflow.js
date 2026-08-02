(function attachMultiPageGrokWorkflow(root, factory) {
  root.MultiPageGrokWorkflow = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createMultiPageGrokWorkflow() {
  function freezeDeep(entry) {
    if (!entry || typeof entry !== 'object' || Object.isFrozen(entry)) {
      return entry;
    }
    Object.getOwnPropertyNames(entry).forEach((key) => {
      freezeDeep(entry[key]);
    });
    return Object.freeze(entry);
  }

  const TARGET_WEBCHAT2API = 'webchat2api';
  const TARGET_GROK2API = 'grok2api';
  const TARGET_SUB2API = 'sub2api';

  function numberSteps(steps = []) {
    return steps.map((step, index) => ({
      ...step,
      id: index + 1,
      order: (index + 1) * 10,
    }));
  }

  const REGISTER_STEPS = [
    {
      key: 'grok-open-signup-page',
      title: '打开 Grok 注册页',
      sourceId: 'grok-register-page',
      driverId: 'flows/grok/background/register-runner',
      command: 'grok-open-signup-page',
      flowId: 'grok',
    },
    {
      key: 'grok-submit-email',
      title: '获取邮箱并继续',
      sourceId: 'grok-register-page',
      driverId: 'flows/grok/background/register-runner',
      command: 'grok-submit-email',
      flowId: 'grok',
    },
    {
      key: 'grok-submit-verification-code',
      title: '获取验证码并继续',
      sourceId: 'grok-register-page',
      driverId: 'flows/grok/background/register-runner',
      command: 'grok-submit-verification-code',
      mailRuleId: 'grok-submit-verification-code',
      flowId: 'grok',
    },
    {
      key: 'grok-submit-profile',
      title: '填写资料并继续',
      sourceId: 'grok-register-page',
      driverId: 'flows/grok/background/register-runner',
      command: 'grok-submit-profile',
      flowId: 'grok',
    },
  ];

  const WEBCHAT2API_TAIL = [
    {
      key: 'grok-extract-sso-cookie',
      title: '提取 SSO Cookie',
      sourceId: 'grok-register-page',
      driverId: 'flows/grok/background/register-runner',
      command: 'grok-extract-sso-cookie',
      flowId: 'grok',
    },
    {
      key: 'grok-upload-sso-to-webchat2api',
      title: '上传 SSO 到 webchat2api',
      sourceId: 'grok-webchat2api',
      driverId: 'flows/grok/background/publisher-webchat2api',
      command: 'grok-upload-sso-to-webchat2api',
      flowId: 'grok',
    },
  ];

  const GROK2API_TAIL = [
    {
      key: 'grok-extract-sso-cookie',
      title: '提取 SSO Cookie',
      sourceId: 'grok-register-page',
      driverId: 'flows/grok/background/register-runner',
      command: 'grok-extract-sso-cookie',
      flowId: 'grok',
    },
    {
      key: 'grok-upload-sso-to-grok2api',
      title: '上传 SSO 到 grok2api',
      sourceId: 'grok-grok2api',
      driverId: 'flows/grok/background/publisher-grok2api',
      command: 'grok-upload-sso-to-grok2api',
      flowId: 'grok',
    },
  ];

  const SUB2API_OAUTH_TAIL = [
    {
      key: 'grok-start-sub2api-oauth',
      title: '获取 SUB2API OAuth 授权',
      sourceId: 'grok-sub2api-oauth-page',
      driverId: 'flows/grok/background/sub2api-oauth-runner',
      command: 'grok-start-sub2api-oauth',
      flowId: 'grok',
    },
    {
      key: 'grok-complete-sub2api-oauth',
      title: '完成 SUB2API OAuth 授权',
      sourceId: 'grok-sub2api-oauth-page',
      driverId: 'flows/grok/background/sub2api-oauth-runner',
      command: 'grok-complete-sub2api-oauth',
      flowId: 'grok',
    },
  ];

  const WEBCHAT2API_STEPS = numberSteps([...REGISTER_STEPS, ...WEBCHAT2API_TAIL]);
  const GROK2API_STEPS = numberSteps([...REGISTER_STEPS, ...GROK2API_TAIL]);
  const SUB2API_STEPS = numberSteps([...REGISTER_STEPS, ...SUB2API_OAUTH_TAIL]);
  const SUB2API_DUAL_PUBLISH_STEPS = numberSteps([
    ...REGISTER_STEPS,
    ...GROK2API_TAIL,
    ...SUB2API_OAUTH_TAIL,
  ]);
  const ALL_STEPS = numberSteps([
    ...REGISTER_STEPS,
    ...WEBCHAT2API_TAIL,
    GROK2API_TAIL.at(-1),
    ...SUB2API_OAUTH_TAIL,
  ]);

  const STEP_VARIANTS = freezeDeep({
    default: WEBCHAT2API_STEPS,
    webchat2api: WEBCHAT2API_STEPS,
    grok2api: GROK2API_STEPS,
    sub2api: SUB2API_STEPS,
    'sub2api-dual-publish': SUB2API_DUAL_PUBLISH_STEPS,
  });

  function getVariantStepDefinitions(variantKey = 'default') {
    return Array.isArray(STEP_VARIANTS[variantKey]) ? STEP_VARIANTS[variantKey] : STEP_VARIANTS.default;
  }

  function getModeStepDefinitions(options = {}) {
    const targetId = String(options?.targetId || '').trim().toLowerCase();
    if (targetId === TARGET_GROK2API) {
      return getVariantStepDefinitions(TARGET_GROK2API);
    }
    if (targetId !== TARGET_SUB2API) {
      return getVariantStepDefinitions(TARGET_WEBCHAT2API);
    }
    return getVariantStepDefinitions(
      options?.grokSub2apiGrok2ApiUploadEnabled
        ? 'sub2api-dual-publish'
        : TARGET_SUB2API
    );
  }

  function getAllSteps() {
    return ALL_STEPS;
  }

  function getPlusPaymentStepTitle() {
    return '';
  }

  function resolveStepTitle(step = {}) {
    return step?.title || '';
  }

  return {
    flowId: 'grok',
    getAllSteps,
    getModeStepDefinitions,
    getPlusPaymentStepTitle,
    getVariantStepDefinitions,
    resolveStepTitle,
  };
});
