(function attachCpamReauthController(root, factory) {
  root.MultiPageBackgroundCpamReauthController = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createCpamReauthControllerModule() {
  const REAUTH_NODE_IDS = [
    'oauth-login',
    'fetch-login-code',
    'post-login-phone-verification',
    'confirm-oauth',
    'platform-verify',
  ];
  const OPENAI_COOKIE_DOMAINS = [
    'auth.openai.com',
    'accounts.openai.com',
    'chatgpt.com',
    'chat.openai.com',
    'openai.com',
    'auth0.openai.com',
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function errorMessage(error) {
    return String(error?.message || error || 'Unknown ReAuth error');
  }

  function redactCpamAccessToken(message, accessToken = '') {
    const token = String(accessToken || '').trim();
    const normalizedMessage = String(message || '');
    return token ? normalizedMessage.split(token).join('[REDACTED]') : normalizedMessage;
  }

  function isOpenAiCookieDomain(domain) {
    const normalized = String(domain || '').trim().replace(/^\.+/, '').toLowerCase();
    return OPENAI_COOKIE_DOMAINS.some((allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`));
  }

  function cookieRemovalDetails(cookie) {
    const host = String(cookie?.domain || '').replace(/^\.+/, '');
    const path = String(cookie?.path || '/').startsWith('/') ? String(cookie?.path || '/') : `/${cookie.path}`;
    const details = {
      url: `${cookie?.secure ? 'https' : 'http'}://${host}${path}`,
      name: cookie?.name,
    };
    if (cookie?.storeId) details.storeId = cookie.storeId;
    if (cookie?.partitionKey) details.partitionKey = cookie.partitionKey;
    return details;
  }

  function cookieIdentity(cookie, fallbackStoreId = '') {
    return [
      cookie?.storeId || fallbackStoreId || '',
      cookie?.domain || '',
      cookie?.path || '',
      cookie?.name || '',
      cookie?.partitionKey ? JSON.stringify(cookie.partitionKey) : '',
    ].join('|');
  }

  function createCpamReauthController(deps = {}) {
    const getRunCandidates = typeof deps.getRunCandidates === 'function'
      ? deps.getRunCandidates
      : async () => ({ run: {}, candidates: [], skipped: [] });
    const getState = typeof deps.getState === 'function' ? deps.getState : async () => ({});
    const setState = typeof deps.setState === 'function' ? deps.setState : async () => {};
    const broadcastDataUpdate = typeof deps.broadcastDataUpdate === 'function' ? deps.broadcastDataUpdate : () => {};
    const executeNode = typeof deps.executeNode === 'function' ? deps.executeNode : async () => {};
    const requestStop = typeof deps.requestStop === 'function' ? deps.requestStop : async () => {};
    const getStopRequested = typeof deps.getStopRequested === 'function' ? deps.getStopRequested : null;
    const clearStopRequest = typeof deps.clearStopRequest === 'function' ? deps.clearStopRequest : async () => {};
    const addLog = typeof deps.addLog === 'function' ? deps.addLog : null;
    const listAuthFiles = typeof deps.listAuthFiles === 'function' ? deps.listAuthFiles : null;
    const downloadAuthFile = typeof deps.downloadAuthFile === 'function' ? deps.downloadAuthFile : null;
    const overwriteAuthFile = typeof deps.overwriteAuthFile === 'function' ? deps.overwriteAuthFile : null;
    const deleteAuthFile = typeof deps.deleteAuthFile === 'function' ? deps.deleteAuthFile : null;
    const sleep = typeof deps.sleep === 'function'
      ? deps.sleep
      : (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const chromeApi = deps.chrome;

    let localStopRequested = false;
    let stopGeneration = 0;
    let running = false;
    let initializing = false;
    let activeCpamAccessToken = '';
    let runtime = {
      phase: 'idle',
      queued: 0,
      currentIndex: -1,
      currentItem: null,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      items: [],
      error: null,
      runId: null,
    };

    async function persistRuntime(patch) {
      runtime = { ...runtime, ...patch };
      const runtimeSnapshot = clone(runtime);
      await setState({ reauthRuntime: runtimeSnapshot });
      broadcastDataUpdate({ reauthRuntime: runtimeSnapshot });
      return runtimeSnapshot;
    }

    function safeErrorMessage(error) {
      return redactCpamAccessToken(errorMessage(error), activeCpamAccessToken)
        .replace(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?[^\s'"<>]*/gi, '[REDACTED_CALLBACK_URL]');
    }

    function createRedactedError(error) {
      const redactedError = new Error(safeErrorMessage(error));
      redactedError.name = String(error?.name || 'Error');
      if (error?.code !== undefined) {
        redactedError.code = error.code;
      }
      return redactedError;
    }

    function normalizeReauthFailure(error, fallbackStep = '') {
      const raw = safeErrorMessage(error);
      const step = String(error?.reauthStep || fallbackStep || '').trim();
      if (/\bACCOUNT_DEACTIVATED\b|\baccount_deactivated\b/i.test(raw)) {
        return {
          step,
          error: '账号已被删除或停用（account_deactivated）',
        };
      }
      return { step, error: raw };
    }

    async function stopRequested() {
      if (localStopRequested) return true;
      if (!getStopRequested) return false;
      return Boolean(await getStopRequested());
    }

    async function clearOpenAiCookies() {
      if (typeof deps.clearOpenAiCookies === 'function') {
        return deps.clearOpenAiCookies();
      }
      if (!chromeApi?.cookies || typeof chromeApi.cookies.getAll !== 'function' || typeof chromeApi.cookies.remove !== 'function') {
        return 0;
      }

      const cookies = [];
      const seen = new Set();
      const appendCookies = (batch, fallbackStoreId = '') => {
        for (const rawCookie of Array.isArray(batch) ? batch : []) {
          if (!isOpenAiCookieDomain(rawCookie?.domain)) continue;
          const cookie = rawCookie?.storeId || !fallbackStoreId
            ? rawCookie
            : { ...rawCookie, storeId: fallbackStoreId };
          const identity = cookieIdentity(cookie, fallbackStoreId);
          if (seen.has(identity)) continue;
          seen.add(identity);
          cookies.push(cookie);
        }
      };

      let storeQueries = null;
      if (typeof chromeApi.cookies.getAllCookieStores === 'function') {
        try {
          const stores = await chromeApi.cookies.getAllCookieStores();
          if (Array.isArray(stores) && stores.length > 0) {
            storeQueries = stores
              .map((store) => String(store?.id || '').trim())
              .filter(Boolean)
              .map((storeId) => ({ storeId }));
          }
        } catch {
          storeQueries = null;
        }
      }

      let needsFallback = !storeQueries?.length;
      for (const query of storeQueries || []) {
        try {
          appendCookies(await chromeApi.cookies.getAll(query), query.storeId);
        } catch {
          needsFallback = true;
        }
      }
      if (needsFallback) {
        try {
          appendCookies(await chromeApi.cookies.getAll({}));
        } catch {
          return 0;
        }
      }

      let removed = 0;
      for (const cookie of cookies) {
        if (!isOpenAiCookieDomain(cookie?.domain)) continue;
        try {
          const result = await chromeApi.cookies.remove(cookieRemovalDetails(cookie));
          if (result) removed += 1;
        } catch {
          // Continue clearing the remaining allowed authentication cookies.
        }
      }
      return removed;
    }

    function validateStartState(state) {
      if (String(state?.targetId || '').trim().toLowerCase() !== 'cpa') {
        throw new Error('CPAM ReAuth requires the CPA target.');
      }
      if (String(state?.accountDeliveryMode || '').trim().toLowerCase() !== 'oauth') {
        throw new Error('CPAM ReAuth requires OAuth account delivery.');
      }
      const password = state?.currentPassword || state?.password || state?.customPassword;
      if (!String(password || '').trim()) {
        throw new Error('CPAM ReAuth requires a current password.');
      }
    }

    async function log(message, level = 'info') {
      if (addLog) await addLog(message, level);
    }

    async function logStartFailure(error) {
      try {
        await log(`CPAM ReAuth start failed: ${safeErrorMessage(error)}`, 'error');
      } catch {
        // Preserve the original start error when activity-log persistence fails.
      }
    }

    function normalizeEmail(value = '') {
      return String(value || '').trim().toLowerCase();
    }

    function findGeneratedAuthFile(files, item, baselineNames) {
      const email = normalizeEmail(item?.email);
      const accountId = String(item?.accountId || '').trim();
      return (Array.isArray(files) ? files : []).find((file) => {
        const name = String(file?.name || '').trim();
        if (!name || name === item?.fileName || baselineNames.has(name)) return false;
        const fileEmail = normalizeEmail(file?.email);
        const fileAccountId = String(file?.id_token?.chatgpt_account_id || '').trim();
        return Boolean((email && fileEmail === email) || (accountId && fileAccountId === accountId));
      }) || null;
    }

    function createReauthStepError(message, step) {
      const error = new Error(message);
      error.reauthStep = step;
      return error;
    }

    async function safelyReplaceOriginalAuthFile(state, item, baselineNames) {
      if (!listAuthFiles || !downloadAuthFile || !overwriteAuthFile || !deleteAuthFile) {
        throw createReauthStepError('CPA 文件替换功能不可用。', 'cpa-file-replace');
      }
      let generated = null;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        generated = findGeneratedAuthFile(await listAuthFiles(state), item, baselineNames);
        if (generated) break;
        if (attempt < 9) await sleep(1000);
      }
      if (!generated) {
        throw createReauthStepError('CPA 文件替换未找到新的认证文件。', 'cpa-file-replace');
      }
      const generatedName = String(generated.name || '').trim();
      try {
        const credential = await downloadAuthFile(state, generatedName);
        await overwriteAuthFile(state, item.fileName, credential);
        await deleteAuthFile(state, generatedName);
      } catch (error) {
        throw createReauthStepError(`CPA 文件替换失败：${safeErrorMessage(error)}`, 'cpa-file-replace');
      }
      return { status: 'replaced', generatedFileName: generatedName };
    }

    async function executeCandidate(item) {
      const initialState = await getState();
      const replaceOriginalFile = initialState?.cpamReauthReplaceOriginalFile === true;
      let baselineNames = null;
      if (replaceOriginalFile) {
        if (!listAuthFiles) {
          throw createReauthStepError('CPA 文件替换功能不可用。', 'cpa-file-replace');
        }
        baselineNames = new Set((await listAuthFiles(initialState))
          .map((file) => String(file?.name || '').trim())
          .filter(Boolean));
      }
      await clearOpenAiCookies();
      if (await stopRequested()) return 'stopped';

      await setState({
        email: item.email,
        accountIdentifierType: 'email',
        accountIdentifier: item.email,
        signupMethod: 'email',
        resolvedSignupMethod: 'email',
        oauthUrl: null,
        localhostUrl: null,
        cpaOAuthState: null,
        cpaManagementOrigin: null,
        oauthFlowDeadlineAt: null,
        oauthFlowDeadlineSourceUrl: null,
      });

      for (const nodeId of REAUTH_NODE_IDS) {
        if (await stopRequested()) return 'stopped';
        const state = await getState();
        try {
          await executeNode(nodeId, { ...state, nodeId, reauthItem: item, reauthMode: true });
          if (await stopRequested()) return 'stopped';
        } catch (error) {
          if (await stopRequested()) return 'stopped';
          if (error && typeof error === 'object') {
            error.reauthStep = error.reauthStep || nodeId;
            throw error;
          }
          const nodeError = new Error(errorMessage(error));
          nodeError.reauthStep = nodeId;
          throw nodeError;
        }
      }
      if (replaceOriginalFile) {
        item.replacement = await safelyReplaceOriginalAuthFile(await getState(), item, baselineNames);
      }
      return 'succeeded';
    }

    function makeSummary() {
      return {
        queued: runtime.queued,
        succeeded: runtime.succeeded,
        failed: runtime.failed,
        skipped: runtime.skipped,
        items: clone(runtime.items),
      };
    }

    function isDeactivatedItem(item) {
      return item?.status === 'failed' && /\baccount_deactivated\b/i.test(String(item?.error || ''));
    }

    function recount(items) {
      return (Array.isArray(items) ? items : []).reduce((counts, item) => {
        if (item?.status === 'succeeded') counts.succeeded += 1;
        else if (item?.status === 'failed') counts.failed += 1;
        else if (item?.status === 'skipped') counts.skipped += 1;
        return counts;
      }, { succeeded: 0, failed: 0, skipped: 0 });
    }

    function markPendingItemsStopped(items) {
      let newlySkipped = 0;
      const markedItems = (Array.isArray(items) ? items : []).map((item) => {
        if (item?.status !== 'pending') return item;
        newlySkipped += 1;
        return { ...item, status: 'skipped', reason: 'stopped', error: 'stopped' };
      });
      return { items: markedItems, newlySkipped };
    }

    async function finishStopped(patch = {}) {
      const marked = markPendingItemsStopped(
        Object.prototype.hasOwnProperty.call(patch, 'items') ? patch.items : runtime.items
      );
      const skipped = Object.prototype.hasOwnProperty.call(patch, 'skipped')
        ? patch.skipped
        : runtime.skipped;
      await persistRuntime({
        ...patch,
        phase: 'stopped',
        currentItem: null,
        items: marked.items,
        skipped: skipped + marked.newlySkipped,
      });
      return makeSummary();
    }

    async function finishStoppedBeforeCandidates() {
      return finishStopped({
        queued: 0,
        currentIndex: -1,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        items: [],
        error: null,
        runId: null,
      });
    }

    async function start() {
      if (running || initializing) throw new Error('CPAM ReAuth is already running.');
      initializing = true;
      localStopRequested = false;
      activeCpamAccessToken = '';
      const startingStopGeneration = stopGeneration;

      try {
        await clearStopRequest();
      } catch (error) {
        initializing = false;
        throw error;
      }

      if (localStopRequested || stopGeneration !== startingStopGeneration) {
        initializing = false;
        return finishStoppedBeforeCandidates();
      }

      let state;
      try {
        state = await getState();
        if (localStopRequested || stopGeneration !== startingStopGeneration) {
          initializing = false;
          return finishStoppedBeforeCandidates();
        }
        activeCpamAccessToken = String(state?.cpamAccessToken || '').trim();
        validateStartState(state);
      } catch (error) {
        initializing = false;
        const redactedError = createRedactedError(error);
        await logStartFailure(redactedError);
        throw redactedError;
      }

      let selection;
      try {
        selection = await getRunCandidates(state);
      } catch (error) {
        initializing = false;
        const redactedError = createRedactedError(error);
        await persistRuntime({ phase: 'failed', error: redactedError.message });
        await logStartFailure(redactedError);
        throw redactedError;
      }

      const candidates = Array.isArray(selection?.candidates) ? selection.candidates : [];
      const skipped = Array.isArray(selection?.skipped) ? selection.skipped : [];
      const candidateItems = candidates.map((item) => ({ ...item, status: 'pending', error: null }));
      const skippedItems = skipped.map((item) => ({ ...item, status: 'skipped', error: item?.reason || null }));

      running = true;
      initializing = false;
      const initialRuntime = {
        queued: candidates.length,
        currentIndex: -1,
        currentItem: null,
        succeeded: 0,
        failed: 0,
        skipped: skipped.length,
        items: [...candidateItems, ...skippedItems],
        error: null,
        runId: selection?.run?.id ?? null,
      };

      try {
        if (await stopRequested()) {
          return finishStopped(initialRuntime);
        }
        await persistRuntime({
          phase: 'running',
          ...initialRuntime,
        });
        for (let index = 0; index < candidates.length; index += 1) {
          if (await stopRequested()) break;
          const item = candidates[index];
          await persistRuntime({ currentIndex: index, currentItem: clone(item) });
          try {
            const result = await executeCandidate(item);
            if (result === 'stopped') {
              const items = clone(runtime.items);
              items[index] = { ...items[index], status: 'stopped', error: null };
              await persistRuntime({ items });
              break;
            }
            const items = clone(runtime.items);
            items[index] = { ...items[index], status: 'succeeded', error: null, ...(item.replacement ? { replacement: item.replacement } : {}) };
            await persistRuntime({ items, succeeded: runtime.succeeded + 1 });
            await log(`CPAM ReAuth completed for ${item.email}.`);
          } catch (error) {
            const items = clone(runtime.items);
            const failure = normalizeReauthFailure(error);
            items[index] = { ...items[index], status: 'failed', ...failure };
            await persistRuntime({ items, failed: runtime.failed + 1 });
            await log(`CPAM ReAuth failed for ${item.email}.`);
          }
        }

        if (await stopRequested()) {
          return finishStopped();
        }
        await persistRuntime({ phase: 'completed', currentItem: null });
        return makeSummary();
      } catch (error) {
        const redactedError = createRedactedError(error);
        await persistRuntime({ phase: 'failed', currentItem: null, error: redactedError.message });
        throw redactedError;
      } finally {
        running = false;
      }
    }

    async function stop() {
      if (!running && !initializing) return makeSummary();
      localStopRequested = true;
      stopGeneration += 1;
      let requestStopResult;
      try {
        requestStopResult = requestStop();
      } catch (error) {
        requestStopResult = Promise.reject(error);
      }
      try {
        await persistRuntime({ phase: 'stopping' });
      } catch {
        // A stop signal must not be delayed or invalidated by state persistence.
      }
      await requestStopResult;
      return makeSummary();
    }

    async function retryFailed() {
      if (running || initializing) throw new Error('CPAM ReAuth 正在运行，暂不能重试。');
      const retryIndexes = runtime.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item?.status === 'failed' && !isDeactivatedItem(item))
        .sort((left, right) => Number(left.item?.position ?? left.index) - Number(right.item?.position ?? right.index));
      if (!retryIndexes.length) return makeSummary();
      running = true;
      await persistRuntime({ phase: 'retrying', currentItem: null, error: null });
      try {
        for (const { item, index } of retryIndexes) {
          await persistRuntime({ currentIndex: index, currentItem: clone(item) });
          try {
            const result = await executeCandidate(item);
            const items = clone(runtime.items);
            if (result === 'stopped') break;
            items[index] = { ...items[index], status: 'succeeded', error: null, step: null, ...(item.replacement ? { replacement: item.replacement } : {}) };
            await persistRuntime({ items, ...recount(items) });
          } catch (error) {
            const items = clone(runtime.items);
            items[index] = { ...items[index], status: 'failed', ...normalizeReauthFailure(error) };
            await persistRuntime({ items, ...recount(items) });
          }
        }
        await persistRuntime({ phase: 'completed', currentItem: null });
        return makeSummary();
      } finally {
        running = false;
      }
    }

    async function deleteDeactivated() {
      if (running || initializing) throw new Error('CPAM ReAuth 正在运行，暂不能删除。');
      if (!deleteAuthFile) throw new Error('CPA 文件删除功能不可用。');
      const targets = runtime.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => isDeactivatedItem(item) && item?.deleteStatus !== 'deleted' && String(item?.fileName || '').trim());
      if (!targets.length) return makeSummary();
      running = true;
      await persistRuntime({ phase: 'deleting', currentItem: null, error: null });
      try {
        const state = await getState();
        for (const { item, index } of targets) {
          await persistRuntime({ currentIndex: index, currentItem: clone(item) });
          const items = clone(runtime.items);
          try {
            await deleteAuthFile(state, item.fileName);
            items[index] = { ...items[index], deleteStatus: 'deleted', deleteError: null };
          } catch (error) {
            items[index] = { ...items[index], deleteStatus: 'failed', deleteError: safeErrorMessage(error) };
          }
          await persistRuntime({ items });
        }
        await persistRuntime({ phase: 'completed', currentItem: null });
        return makeSummary();
      } finally {
        running = false;
      }
    }

    function getRuntimeState() {
      return clone(runtime);
    }

    return {
      start,
      stop,
      retryFailed,
      deleteDeactivated,
      getRuntimeState,
      clearOpenAiCookies,
    };
  }

  return {
    createCpamReauthController,
    REAUTH_NODE_IDS,
  };
});
