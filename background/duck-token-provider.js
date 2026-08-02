(function duckTokenProviderModule(root, factory) {
  root.MultiPageBackgroundDuckTokenProvider = factory(root);
})(typeof self !== 'undefined' ? self : globalThis, function createDuckTokenProviderModule(root = globalThis) {
  const DUCK_DDG_ADDRESSES_URL = 'https://quack.duckduckgo.com/api/email/addresses';
  const DUCK_DDG_DAILY_LIMIT_ERROR_PREFIX = 'DDG_DAILY_LIMIT::';

  function normalizeDuckDdgToken(value = '') {
    const trimmed = String(value || '').trim().replace(/^["']|["']$/g, '');
    const bearerMatch = trimmed.match(/^Bearer\s+(.+)$/i);
    return (bearerMatch ? bearerMatch[1] : trimmed).trim();
  }

  function normalizeDuckAddress(value = '') {
    const trimmed = String(value || '').trim().toLowerCase();
    const duckEmailMatch = trimmed.match(/^([a-z0-9._%+-]+)@duck\.com$/i);
    if (duckEmailMatch) {
      return `${duckEmailMatch[1].toLowerCase()}@duck.com`;
    }
    if (/^[a-z0-9._%+-]+$/i.test(trimmed)) {
      return `${trimmed.toLowerCase()}@duck.com`;
    }
    return '';
  }

  function isDuckDdgDailyLimitMessage(message = '') {
    const text = String(message || '').trim();
    if (!text) {
      return false;
    }
    return /DDG_DAILY_LIMIT::|DuckDuckGo[\s\S]*(?:每日|每天|今日|日上限|日限|单日|一天)[\s\S]*(?:限制|限额|上限|额度|次数|数量|已达|达到|超出|超过|用完)|Duck[\s\S]*(?:每日|每天|今日|日上限|日限|单日|一天)[\s\S]*(?:限制|限额|上限|额度|次数|数量|已达|达到|超出|超过|用完)|(?:每日|每天|今日|日上限|日限|单日|一天)[\s\S]*(?:Duck|地址|邮箱|生成)[\s\S]*(?:限制|限额|上限|额度|次数|数量|已达|达到|超出|超过|用完)|(?:daily|day|24\s*hours?)[\s_-]*(?:limit|quota|cap|maximum|max)|(?:limit|quota|maximum|max)[\s\S]*(?:per\s*day|daily|24\s*hours?)|(?:daily|quota|limit)[\s_-]*(?:exceeded|reached)|(?:reached|exceeded)[\s\S]*(?:daily|quota|limit|maximum|max)[\s\S]*(?:Duck|address|email|generate)|(?:too\s+many|maximum|max)[\s\S]*(?:Duck|private\s+address|email\s+address|addresses)/i.test(text);
  }

  function createDuckDdgDailyLimitError(message = '') {
    const detail = String(message || '').trim() || '已达到每日生成限制';
    return new Error(`${DUCK_DDG_DAILY_LIMIT_ERROR_PREFIX}DuckDuckGo 地址生成已达到每日限制：${detail}`);
  }

  function isDuckDdgDailyLimitFailure(error) {
    const message = error instanceof Error ? error.message : String(error || '');
    return isDuckDdgDailyLimitMessage(message);
  }

  function parseDuckApiAddress(payload) {
    if (!payload || typeof payload !== 'object') {
      return '';
    }
    return normalizeDuckAddress(
      payload.address
      || payload.email
      || payload?.data?.address
      || payload?.data?.email
      || ''
    );
  }

  function extractBearerTokenFromHeaders(headers = []) {
    const list = Array.isArray(headers) ? headers : [];
    const authHeader = list.find((header) => String(header?.name || '').toLowerCase() === 'authorization');
    return normalizeDuckDdgToken(authHeader?.value || '');
  }

  function createDuckTokenProvider(deps = {}) {
    const {
      addLog = async () => {},
      broadcastDataUpdate = () => {},
      chromeApi = root.chrome,
      DUCK_AUTOFILL_URL = 'https://duckduckgo.com/email/settings/autofill',
      fetchImpl = typeof fetch === 'function' ? fetch.bind(root) : null,
      reuseOrCreateTab = async () => {},
      sendToContentScript = async () => ({}),
      setPersistentSettings = async () => ({}),
      throwIfStopped = () => {},
    } = deps;

    async function requestDuckAddressWithToken(token, options = {}) {
      throwIfStopped();
      const normalizedToken = normalizeDuckDdgToken(token);
      if (!normalizedToken) {
        throw new Error('DDG Token 为空，请先填写或自动获取 DDG Token。');
      }
      if (!fetchImpl) {
        throw new Error('当前运行环境不支持 fetch，无法直连 DuckDuckGo API。');
      }

      const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 20000);
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller
        ? setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
        : null;

      let response;
      try {
        response = await fetchImpl(DUCK_DDG_ADDRESSES_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${normalizedToken}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
          ...(controller ? { signal: controller.signal } : {}),
        });
      } catch (err) {
        const isTimeout = err?.name === 'AbortError' || err?.message === 'timeout';
        throw new Error(isTimeout
          ? `DuckDuckGo API 请求超时（${Math.round(timeoutMs / 1000)} 秒）。`
          : `DuckDuckGo API 请求失败：${err?.message || err}`);
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }

      const text = await response.text();
      let parsed = {};
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = {};
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('DDG Token 已失效或没有权限，请重新登录 DuckDuckGo Email Protection 后获取。');
        }
        const detail = parsed?.error || parsed?.message || parsed?.detail || text || `HTTP ${response.status}`;
        if (response.status === 429) {
          throw createDuckDdgDailyLimitError(detail);
        }
        if (isDuckDdgDailyLimitMessage(detail)) {
          throw createDuckDdgDailyLimitError(detail);
        }
        throw new Error(`DuckDuckGo API 请求失败：${detail}`);
      }

      const email = parseDuckApiAddress(parsed);
      if (!email) {
        const detail = parsed?.error || parsed?.message || parsed?.detail || text;
        if (isDuckDdgDailyLimitMessage(detail)) {
          throw createDuckDdgDailyLimitError(detail);
        }
        throw new Error('DuckDuckGo API 未返回可用的 @duck.com 地址。');
      }
      return email;
    }

    async function waitForDuckTokenRequest(options = {}) {
      const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 20000);
      if (!chromeApi?.webRequest?.onBeforeSendHeaders) {
        throw new Error('当前扩展环境不支持监听请求头，无法自动获取 DDG Token。');
      }

      let cleanup = () => {};
      const tokenPromise = new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          cleanup();
          callback(value);
        };
        const timeoutId = setTimeout(() => {
          finish(reject, new Error('自动获取 DDG Token 超时，请确认已登录 DuckDuckGo Email Protection 并已启用邮箱保护。'));
        }, timeoutMs);
        const listener = (details = {}) => {
          const token = extractBearerTokenFromHeaders(details.requestHeaders);
          if (token) {
            finish(resolve, token);
          }
        };
        cleanup = () => {
          clearTimeout(timeoutId);
          try {
            if (chromeApi.webRequest.onBeforeSendHeaders.hasListener?.(listener)) {
              chromeApi.webRequest.onBeforeSendHeaders.removeListener(listener);
            } else {
              chromeApi.webRequest.onBeforeSendHeaders.removeListener(listener);
            }
          } catch {
            // ignore cleanup failures
          }
        };
        const filter = {
          urls: [`${DUCK_DDG_ADDRESSES_URL}*`],
        };
        try {
          chromeApi.webRequest.onBeforeSendHeaders.addListener(listener, filter, ['requestHeaders', 'extraHeaders']);
        } catch {
          try {
            chromeApi.webRequest.onBeforeSendHeaders.addListener(listener, filter, ['requestHeaders']);
          } catch (err) {
            finish(reject, new Error(`无法监听 DuckDuckGo 请求头：${err?.message || err}`));
          }
        }
      });

      try {
        await addLog('DuckDuckGo：正在打开 Email Protection 页面自动获取 DDG Token...');
        await reuseOrCreateTab('duck-mail', DUCK_AUTOFILL_URL);
        const triggerPromise = sendToContentScript('duck-mail', {
          type: 'FETCH_DUCK_EMAIL',
          source: 'background',
          payload: {
            generateNew: true,
            baselineEmail: normalizeDuckAddress(options.baselineEmail || ''),
          },
        }).then((result) => {
          if (result?.error) {
            throw new Error(`DuckDuckGo 未登录或 Email Protection 页面不可用，无法自动获取 DDG Token。原始错误：${result.error}`);
          }
          return new Promise(() => {});
        }, (err) => {
          throw new Error(`DuckDuckGo 未登录或 Email Protection 页面不可用，无法自动获取 DDG Token。原始错误：${err?.message || err}`);
        });

        return await Promise.race([tokenPromise, triggerPromise]);
      } finally {
        cleanup();
      }
    }

    async function ensureDuckDdgToken(state = {}, options = {}) {
      const configuredToken = normalizeDuckDdgToken(options.duckDdgToken ?? state?.duckDdgToken);
      if (configuredToken) {
        return configuredToken;
      }

      throwIfStopped();
      const capturedToken = await waitForDuckTokenRequest({
        baselineEmail: options.baselineEmail,
        timeoutMs: options.captureTimeoutMs,
      });
      if (!capturedToken) {
        throw new Error('未捕获到 DDG Token，请确认 DuckDuckGo 已登录后重试。');
      }

      await setPersistentSettings({ duckDdgToken: capturedToken });
      broadcastDataUpdate({ duckDdgToken: capturedToken });
      await addLog('DuckDuckGo：已自动获取并保存 DDG Token。', 'ok');
      return capturedToken;
    }

    async function fetchDuckEmailWithToken(state = {}, options = {}) {
      throwIfStopped();
      const token = await ensureDuckDdgToken(state, options);
      const email = await requestDuckAddressWithToken(token, options);
      await addLog(`DuckDuckGo：Token 直连已生成 ${email}`, 'ok');
      return {
        email,
        token,
      };
    }

    return {
      ensureDuckDdgToken,
      fetchDuckEmailWithToken,
      normalizeDuckAddress,
      normalizeDuckDdgToken,
      requestDuckAddressWithToken,
      waitForDuckTokenRequest,
    };
  }

  return {
    createDuckTokenProvider,
    isDuckDdgDailyLimitFailure,
    isDuckDdgDailyLimitMessage,
    normalizeDuckAddress,
    normalizeDuckDdgToken,
  };
});
