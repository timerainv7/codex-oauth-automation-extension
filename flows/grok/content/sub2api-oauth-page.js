(function attachGrokSub2ApiOAuthPage(root, factory) {
  const api = factory();
  root.MultiPageGrokSub2ApiOAuthPage = api;
  api.installListener();
})(typeof self !== 'undefined' ? self : globalThis, function createGrokSub2ApiOAuthPage() {
  const LISTENER_SENTINEL = 'data-flowpilot-grok-sub2api-oauth-listener';
  const CONSENT_PAGE_PATTERN = /授权\s*Grok Build|Authorize\s+Grok Build/i;
  const ALLOW_ACTION_PATTERN = /^(?:允许|Allow|Authorize|Continue)$/i;
  const CODE_PAGE_PATTERN = /输入此代码以完成登录|Enter this code to (?:complete|finish) (?:sign[ -]?in|login)|copy (?:the )?code to Grok Build/i;
  const ERROR_PAGE_PATTERN = /授权失败|拒绝授权|authorization (?:failed|denied)|access denied|something went wrong/i;

  function cleanText(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeAuthorizationCode(value = '') {
    const code = cleanText(value);
    if (code.length < 16 || /\s/.test(code) || !/^[A-Za-z0-9._~-]+$/.test(code)) {
      return '';
    }
    return code;
  }

  function classifyPageSnapshot(snapshot = {}) {
    const pageText = cleanText(snapshot.pageText);
    const actionIndex = (Array.isArray(snapshot.actionTexts) ? snapshot.actionTexts : [])
      .findIndex((text) => ALLOW_ACTION_PATTERN.test(cleanText(text)));
    if (ERROR_PAGE_PATTERN.test(pageText)) {
      return {
        state: 'error_page',
        error: 'Grok OAuth 授权页面显示失败。',
      };
    }
    if (CONSENT_PAGE_PATTERN.test(pageText) && actionIndex >= 0) {
      return { state: 'consent_page', actionIndex };
    }
    if (CODE_PAGE_PATTERN.test(pageText)) {
      const code = (Array.isArray(snapshot.codeCandidates) ? snapshot.codeCandidates : [])
        .map(normalizeAuthorizationCode)
        .find(Boolean);
      return code ? { state: 'code_page', code } : { state: 'code_waiting' };
    }
    if (CONSENT_PAGE_PATTERN.test(pageText)) {
      return { state: 'consent_waiting' };
    }
    return { state: 'loading' };
  }

  function isVisible(element) {
    if (!element || typeof window === 'undefined') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && rect.width > 0
      && rect.height > 0;
  }

  function getElementTextValues(element) {
    return [
      element?.textContent,
      element?.value,
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('title'),
    ].map(cleanText).filter(Boolean);
  }

  function getActionText(element) {
    const values = getElementTextValues(element);
    return values.find((value) => ALLOW_ACTION_PATTERN.test(value)) || values[0] || '';
  }

  function getCodeCandidate(element) {
    const value = cleanText(element?.value);
    return value || cleanText(element?.textContent);
  }

  function collectVisible(selector) {
    if (typeof document === 'undefined') return [];
    return Array.from(document.querySelectorAll(selector)).filter(isVisible);
  }

  function inspectPage() {
    const actions = collectVisible('button, [role="button"], input[type="button"], input[type="submit"]')
      .filter((element) => !element.disabled && element.getAttribute('aria-disabled') !== 'true');
    const codeElements = collectVisible([
      'input[readonly]',
      'textarea[readonly]',
      'code',
      '[data-testid*="code" i]',
      '[aria-label*="code" i]',
    ].join(', '));
    const classified = classifyPageSnapshot({
      pageText: cleanText(`${document.title || ''} ${document.body?.textContent || ''}`),
      actionTexts: actions.map(getActionText),
      codeCandidates: codeElements.map(getCodeCandidate),
    });
    return {
      ...classified,
      url: location.href,
      actionElement: Number.isInteger(classified.actionIndex) ? actions[classified.actionIndex] : null,
    };
  }

  function getPublicPageState() {
    const state = inspectPage();
    if (state.state === 'error_page') {
      throw new Error(state.error || 'Grok OAuth 授权失败。');
    }
    return {
      state: state.state,
      url: state.url,
      ...(state.code ? { code: state.code } : {}),
    };
  }

  function confirmConsent() {
    const state = inspectPage();
    if (state.state !== 'consent_page' || !state.actionElement) {
      throw new Error(`当前页面不是 Grok OAuth 授权确认页：${state.state}`);
    }
    if (typeof simulateClick === 'function') {
      simulateClick(state.actionElement);
    } else {
      state.actionElement.click();
    }
    return { submitted: true, state: 'consent_submitted', url: location.href };
  }

  async function handleMessage(message = {}) {
    if (message.type === 'GET_GROK_SUB2API_OAUTH_STATE') {
      return getPublicPageState();
    }
    if (message.type === 'EXECUTE_GROK_SUB2API_OAUTH_ACTION') {
      if (String(message.payload?.action || '').trim() === 'confirm-consent') {
        return confirmConsent();
      }
      throw new Error(`未知 Grok SUB2API OAuth 动作：${message.payload?.action || ''}`);
    }
    return null;
  }

  function installListener() {
    if (typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.runtime?.onMessage) {
      return;
    }
    if (document.documentElement.getAttribute(LISTENER_SENTINEL) === '1') {
      return;
    }
    document.documentElement.setAttribute(LISTENER_SENTINEL, '1');
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!['GET_GROK_SUB2API_OAUTH_STATE', 'EXECUTE_GROK_SUB2API_OAUTH_ACTION'].includes(message?.type)) {
        return false;
      }
      handleMessage(message)
        .then((result) => sendResponse({ ok: true, ...(result || {}) }))
        .catch((error) => sendResponse({ error: error?.message || String(error || '未知错误') }));
      return true;
    });
  }

  return {
    classifyPageSnapshot,
    getActionText,
    getCodeCandidate,
    getPublicPageState,
    handleMessage,
    installListener,
    normalizeAuthorizationCode,
  };
});
