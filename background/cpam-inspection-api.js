(function attachCpamInspectionApi(root, factory) {
  root.MultiPageBackgroundCpamInspectionApi = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createCpamInspectionApiModule() {
  function normalizeString(value = '') {
    return value === undefined || value === null ? '' : String(value).trim();
  }

  function normalizeBaseUrl(value = '') {
    let parsed;
    try {
      parsed = new URL(normalizeString(value));
    } catch {
      throw new Error('CPAM 服务地址必须使用 HTTP 或 HTTPS。');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('CPAM 服务地址必须使用 HTTP 或 HTTPS。');
    }

    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  }

  function normalizeRunId(value) {
    const runId = normalizeString(value);
    if (!/^\d+$/.test(runId) || !/[1-9]/.test(runId)) {
      throw new Error('请填写有效的 CPAM 巡检运行 ID。');
    }
    return runId;
  }

  function normalizeEmail(value = '') {
    const email = normalizeString(value).toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
  }

  function toCandidate(item, position) {
    const email = normalizeEmail(item?.displayAccount);
    if (!email) {
      return null;
    }

    const fileName = normalizeString(item?.fileName);
    const authIndex = normalizeString(item?.authIndex);
    return {
      key: `${fileName}::${authIndex}`,
      fileName,
      authIndex,
      email,
      accountId: normalizeString(item?.accountId),
      position,
    };
  }

  function createCpamInspectionApi(deps = {}) {
    const fetchImpl = deps.fetchImpl || ((...args) => fetch(...args));

    async function requestJson(path, token) {
      const response = await fetchImpl(
        path,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(String(payload?.message || payload?.error || `CPAM 请求失败（HTTP ${response.status}）`));
      }
      return payload;
    }

    async function resolveRunId(baseUrl, token, rawRunId) {
      const suppliedRunId = normalizeString(rawRunId);
      if (suppliedRunId) {
        return normalizeRunId(suppliedRunId);
      }

      const listPayload = await requestJson(
        `${baseUrl}/v0/management/codex-inspection/runs?limit=20`,
        token
      );
      const latestCompleted = Array.isArray(listPayload?.items)
        ? listPayload.items.find((item) => {
          const id = String(item?.id || '');
          return item?.status === 'completed' && /^\d+$/.test(id) && /[1-9]/.test(id);
        })
        : null;

      if (!latestCompleted) {
        throw new Error('CPAM 没有可用的已完成巡检运行。');
      }
      return normalizeRunId(latestCompleted.id);
    }

    async function getRunCandidates(settings = {}) {
      const token = normalizeString(settings.cpamAccessToken);
      if (!token) {
        throw new Error('请填写 CPAM 访问令牌。');
      }

      const baseUrl = normalizeBaseUrl(settings.cpamBaseUrl);
      const runId = await resolveRunId(baseUrl, token, settings.cpamInspectionRunId);
      const payload = await requestJson(
        `${baseUrl}/v0/management/codex-inspection/runs/${runId}`,
        token
      );
      if (!Array.isArray(payload?.results)) {
        throw new Error('CPAM 巡检响应缺少 results 数组。');
      }

      const seen = new Set();
      const candidates = [];
      const skipped = [];
      payload.results.forEach((item, position) => {
        if (item?.provider !== 'codex' || Number(item?.statusCode) !== 401 || item?.action !== 'reauth') {
          return;
        }

        const candidate = toCandidate(item, position);
        if (!candidate) {
          skipped.push({ position, reason: 'invalid_email' });
          return;
        }
        if (!candidate.fileName || !candidate.authIndex || seen.has(candidate.key)) {
          skipped.push({ position, reason: 'duplicate' });
          return;
        }

        seen.add(candidate.key);
        candidates.push(candidate);
      });

      return {
        run: payload.run || {},
        candidates,
        skipped,
      };
    }

    return {
      getRunCandidates,
      normalizeBaseUrl,
      normalizeRunId,
    };
  }

  return {
    createCpamInspectionApi,
    normalizeBaseUrl,
    normalizeRunId,
  };
});
