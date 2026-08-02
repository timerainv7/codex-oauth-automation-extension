// flows/openai/content/chatgpt-session.js - Read-only ChatGPT session bridge.

(function attachOpenAiChatGptSessionContentScript() {
  const rootScope = typeof window !== 'undefined' ? window : globalThis;
  const listenerSentinel = '__MULTIPAGE_OPENAI_SESSION_LISTENER_READY__';

  if (rootScope[listenerSentinel]) {
    return;
  }
  rootScope[listenerSentinel] = true;

  function normalizeString(value = '') {
    return String(value || '').trim();
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  async function readCurrentSession() {
    const response = await fetch('/api/auth/session', {
      credentials: 'include',
    });
    if (!response?.ok) {
      const status = Math.max(0, Number(response?.status) || 0);
      throw new Error(`读取 ChatGPT 会话失败：HTTP ${status || 'unknown'}`);
    }

    let session = null;
    try {
      session = await response.json();
    } catch (_error) {
      throw new Error('读取 ChatGPT 会话失败：响应不是有效 JSON。');
    }
    if (!isPlainObject(session)) {
      throw new Error('读取 ChatGPT 会话失败：响应格式无效。');
    }

    return {
      session,
      accessToken: normalizeString(session.accessToken || session.access_token),
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (
      message?.type !== 'OPENAI_SESSION_GET_CURRENT'
      || message?.source !== 'background'
    ) {
      return undefined;
    }

    readCurrentSession()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : normalizeString(error) || '读取 ChatGPT 会话失败。',
        });
      });
    return true;
  });
})();
