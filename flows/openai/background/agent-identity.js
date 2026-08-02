(function attachBackgroundOpenAiAgentIdentity(root, factory) {
  root.MultiPageBackgroundOpenAiAgentIdentity = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundOpenAiAgentIdentityModule() {
  const AGENT_VERSION = '0.138.0-alpha.6';
  const AGENT_REGISTER_URL = 'https://auth.openai.com/api/accounts/v1/agent/register';
  const DEFAULT_AGENT_REGISTER_TIMEOUT_MS = 30000;

  function normalizeString(value = '') {
    return String(value || '').trim();
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function decodeBase64UrlUtf8(segment = '') {
    const normalized = normalizeString(segment)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    if (!normalized) {
      throw new Error('accessToken 格式无效，无法解析 OpenAI 身份。');
    }
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

    try {
      if (typeof atob === 'function') {
        const binary = atob(padded);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        return new TextDecoder().decode(bytes);
      }
      if (typeof Buffer !== 'undefined') {
        return Buffer.from(padded, 'base64').toString('utf8');
      }
    } catch (_error) {
      throw new Error('accessToken 格式无效，无法解析 OpenAI 身份。');
    }

    throw new Error('当前环境不支持解析 accessToken。');
  }

  function decodeJwtPayload(accessToken = '') {
    const token = normalizeString(accessToken);
    const parts = token.split('.');
    if (!token || parts.length !== 3 || !parts[1]) {
      throw new Error('accessToken 格式无效，无法解析 OpenAI 身份。');
    }

    try {
      const payload = JSON.parse(decodeBase64UrlUtf8(parts[1]));
      if (!isPlainObject(payload)) {
        throw new Error('invalid payload');
      }
      return payload;
    } catch (_error) {
      throw new Error('accessToken 格式无效，无法解析 OpenAI 身份。');
    }
  }

  function readOpenAiIdentity(accessToken = '', session = null) {
    const claims = decodeJwtPayload(accessToken);
    const auth = isPlainObject(claims['https://api.openai.com/auth'])
      ? claims['https://api.openai.com/auth']
      : {};
    const profile = isPlainObject(claims['https://api.openai.com/profile'])
      ? claims['https://api.openai.com/profile']
      : {};
    const accountId = normalizeString(auth.chatgpt_account_id);
    const userId = normalizeString(auth.chatgpt_user_id || auth.user_id || claims.sub);
    if (!accountId || !userId) {
      throw new Error('accessToken 缺少 OpenAI 账号标识，无法生成 Agent Identity。');
    }

    return {
      accountId,
      userId,
      email: normalizeString(
        profile.email
        || session?.user?.email
        || session?.email
        || claims.email
      ),
      planType: normalizeString(auth.chatgpt_plan_type) || 'free',
    };
  }

  function encodeBase64(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (typeof btoa === 'function') {
      let binary = '';
      for (let index = 0; index < view.length; index += 0x8000) {
        binary += String.fromCharCode(...view.subarray(index, index + 0x8000));
      }
      return btoa(binary);
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(view).toString('base64');
    }
    throw new Error('当前环境不支持 Base64 编码。');
  }

  function encodeSshEd25519PublicKey(rawPublicKey) {
    const publicKey = rawPublicKey instanceof Uint8Array
      ? rawPublicKey
      : new Uint8Array(rawPublicKey);
    if (publicKey.length !== 32) {
      throw new Error('Ed25519 public key 必须是 32 字节。');
    }

    const algorithm = new TextEncoder().encode('ssh-ed25519');
    const bytes = new Uint8Array(4 + algorithm.length + 4 + publicKey.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, algorithm.length);
    bytes.set(algorithm, 4);
    view.setUint32(4 + algorithm.length, publicKey.length);
    bytes.set(publicKey, 8 + algorithm.length);
    return `ssh-ed25519 ${encodeBase64(bytes)}`;
  }

  function readResponseError(payload) {
    const detail = payload?.detail;
    const detailMessage = isPlainObject(detail)
      ? detail.message || detail.error
      : detail;
    return normalizeString(
      payload?.message
      || payload?.error
      || detailMessage
      || payload?.reason
    );
  }

  function redactSensitiveText(value = '', secrets = []) {
    let message = normalizeString(value);
    for (const secret of secrets) {
      const normalizedSecret = normalizeString(secret);
      if (normalizedSecret) {
        message = message.split(normalizedSecret).join('[redacted]');
      }
    }
    return message
      .replace(/Bearer\s+[^\s;,]+/gi, 'Bearer [redacted]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
      .slice(0, 500);
  }

  async function createAgentIdentity(accessToken = '', session = null, options = {}) {
    const token = normalizeString(accessToken);
    if (!token) {
      throw new Error('缺少 ChatGPT accessToken，无法生成 Agent Identity。');
    }
    const identity = readOpenAiIdentity(token, session);
    const cryptoImpl = Object.prototype.hasOwnProperty.call(options, 'cryptoImpl')
      ? options.cryptoImpl
      : globalThis.crypto;
    const fetchImpl = Object.prototype.hasOwnProperty.call(options, 'fetchImpl')
      ? options.fetchImpl
      : (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!cryptoImpl?.subtle) {
      throw new Error('当前浏览器不支持 Web Crypto，无法生成 Agent Identity。');
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('当前环境不支持请求 OpenAI Agent 注册接口。');
    }

    let keyPair = null;
    try {
      keyPair = await cryptoImpl.subtle.generateKey(
        { name: 'Ed25519' },
        true,
        ['sign', 'verify']
      );
    } catch (_error) {
      throw new Error('当前浏览器不支持 Ed25519，无法生成 Agent Identity。');
    }

    let privateKey = null;
    let publicKey = null;
    try {
      [privateKey, publicKey] = await Promise.all([
        cryptoImpl.subtle.exportKey('pkcs8', keyPair.privateKey),
        cryptoImpl.subtle.exportKey('raw', keyPair.publicKey),
      ]);
    } catch (_error) {
      throw new Error('Ed25519 密钥导出失败，无法生成 Agent Identity。');
    }

    const privateKeyBase64 = encodeBase64(privateKey);
    const abortControllerImpl = options.AbortControllerImpl || globalThis.AbortController;
    const controller = typeof abortControllerImpl === 'function'
      ? new abortControllerImpl()
      : null;
    const setTimeoutImpl = options.setTimeoutImpl || ((...args) => setTimeout(...args));
    const clearTimeoutImpl = options.clearTimeoutImpl || ((...args) => clearTimeout(...args));
    const timeoutMs = Math.max(
      1000,
      Math.floor(Number(options.timeoutMs) || DEFAULT_AGENT_REGISTER_TIMEOUT_MS)
    );
    const timeoutId = controller
      ? setTimeoutImpl(() => controller.abort(), timeoutMs)
      : null;

    try {
      const response = await fetchImpl(AGENT_REGISTER_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          abom: {
            agent_version: AGENT_VERSION,
            agent_harness_id: 'codex-cli',
            running_location: 'local',
          },
          agent_public_key: encodeSshEd25519PublicKey(publicKey),
        }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch (_error) {
        payload = null;
      }

      if (!response.ok) {
        const detail = redactSensitiveText(readResponseError(payload), [token, privateKeyBase64]);
        const suffix = detail ? `：${detail}` : '';
        throw new Error(`OpenAI Agent 注册失败（HTTP ${response.status}）${suffix}`);
      }
      const runtimeId = normalizeString(payload?.agent_runtime_id);
      if (!runtimeId) {
        throw new Error('OpenAI Agent 注册未返回 agent_runtime_id。');
      }

      return {
        auth_mode: 'agent_identity',
        agent_identity: {
          agent_runtime_id: runtimeId,
          agent_private_key: privateKeyBase64,
          account_id: identity.accountId,
          chatgpt_user_id: identity.userId,
          email: identity.email,
          plan_type: identity.planType,
          chatgpt_account_is_fedramp: false,
        },
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('OpenAI Agent 注册请求超时。');
      }
      const safeMessage = redactSensitiveText(error?.message || error, [token, privateKeyBase64]);
      throw new Error(safeMessage || 'OpenAI Agent 注册失败。');
    } finally {
      if (timeoutId !== null) {
        clearTimeoutImpl(timeoutId);
      }
    }
  }

  return {
    AGENT_VERSION,
    createAgentIdentity,
    decodeJwtPayload,
    encodeSshEd25519PublicKey,
    readOpenAiIdentity,
  };
});
