(function attachCpamReauthPanel(root, factory) {
  root.SidepanelCpamReauth = factory();
})(window, function createCpamReauthPanelModule() {
  const ACTIVE_PHASES = new Set(['initializing', 'running', 'stopping', 'retrying', 'deleting']);

  function stringValue(input) {
    return String(input?.value || '').trim();
  }

  function countValue(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function formatReauthStep(step) {
    const labels = {
      'oauth-login': 'OAuth 登录',
      'fetch-login-code': '登录验证码',
      'post-login-phone-verification': '登录后手机号验证',
      'confirm-oauth': '确认 OAuth',
      'platform-verify': 'CPA 回调验证',
    };
    return labels[String(step || '').trim()] || '未知步骤';
  }

  function formatSkipReason(reason) {
    const labels = {
      duplicate: '重复巡检结果',
      invalid_email: '无效账户邮箱',
      stopped: '用户停止任务',
    };
    const value = String(reason || '').trim();
    return labels[value] || value || '未知原因';
  }

  function createCpamReauthPanel(context = {}) {
    const dom = context.dom || {};
    const runtime = context.runtime || {};
    const helpers = context.helpers || {};
    const requestSave = typeof context.requestSave === 'function'
      ? context.requestSave
      : (typeof helpers.saveSettings === 'function' ? helpers.saveSettings : async () => {});
    const confirmDeleteDeactivated = typeof helpers.confirmDeleteDeactivated === 'function'
      ? helpers.confirmDeleteDeactivated
      : async () => true;
    let eventsBound = false;
    let saveQueue = Promise.resolve();
    let startInFlight = false;
    let lastRuntimeState = {};

    function collectSettings() {
      return {
        cpamBaseUrl: stringValue(dom.inputBaseUrl),
        cpamAccessToken: stringValue(dom.inputAccessToken),
        cpamInspectionRunId: stringValue(dom.inputInspectionRunId),
        cpamReauthReplaceOriginalFile: dom.inputReplaceOriginalFile?.checked !== false,
      };
    }

    function applySettings(state = {}) {
      if (dom.inputBaseUrl) dom.inputBaseUrl.value = String(state?.cpamBaseUrl || '');
      if (dom.inputAccessToken) dom.inputAccessToken.value = String(state?.cpamAccessToken || '');
      if (dom.inputInspectionRunId) dom.inputInspectionRunId.value = String(state?.cpamInspectionRunId || '');
      if (dom.inputReplaceOriginalFile) dom.inputReplaceOriginalFile.checked = state?.cpamReauthReplaceOriginalFile !== false;
    }

    function render(runtimeState = {}) {
      lastRuntimeState = runtimeState || {};
      const phase = String(runtimeState?.phase || 'idle').trim().toLowerCase() || 'idle';
      const active = ACTIVE_PHASES.has(phase);
      [dom.inputBaseUrl, dom.inputAccessToken, dom.inputInspectionRunId, dom.inputReplaceOriginalFile].forEach((input) => {
        if (input) input.disabled = active;
      });
      if (dom.btnStart) dom.btnStart.disabled = active || startInFlight;
      if (dom.btnStop) dom.btnStop.disabled = !active;

      const currentIndex = countValue(runtimeState?.currentIndex);
      const queued = countValue(runtimeState?.queued);
      const succeeded = countValue(runtimeState?.succeeded);
      const failed = countValue(runtimeState?.failed);
      const skipped = countValue(runtimeState?.skipped);
      let summary = '等待开始。';
      if (active) {
        summary = `运行中：${currentIndex}/${queued}，成功 ${succeeded}，失败 ${failed}，跳过 ${skipped}`;
      } else if (phase === 'completed') {
        summary = `已完成：成功 ${succeeded}，失败 ${failed}，跳过 ${skipped}`;
      } else if (phase === 'failed') {
        summary = `执行失败：成功 ${succeeded}，失败 ${failed}，跳过 ${skipped}`;
      } else if (phase === 'stopped') {
        summary = `已停止：成功 ${succeeded}，失败 ${failed}，跳过 ${skipped}`;
      }
      if (dom.summary) dom.summary.textContent = summary;

      if (dom.results) {
        const items = Array.isArray(runtimeState?.items) ? runtimeState.items : [];
        const retryable = items.filter((item) => item?.status === 'failed' && !/\baccount_deactivated\b/i.test(String(item?.error || '')));
        const deletable = items.filter((item) => item?.status === 'failed' && /\baccount_deactivated\b/i.test(String(item?.error || '')) && item?.deleteStatus !== 'deleted');
        if (dom.btnRetry) {
          dom.btnRetry.textContent = `重试 ReAuth（${retryable.length}）`;
          dom.btnRetry.disabled = active || !retryable.length;
        }
        if (dom.btnDeleteDeactivated) {
          dom.btnDeleteDeactivated.textContent = `删除已停用账户（${deletable.length}）`;
          dom.btnDeleteDeactivated.disabled = active || !deletable.length;
        }
        if (active || !['completed', 'failed', 'stopped'].includes(phase)) {
          dom.results.hidden = true;
          dom.results.textContent = '';
        } else {
          const failures = items.filter((item) => item?.status === 'failed');
          const skippedItems = items.filter((item) => item?.status === 'skipped');
          const lines = [`本次结果：成功 ${succeeded} 个，失败 ${failed} 个，跳过 ${skipped} 个`];
          if (failures.length) {
            lines.push('失败列表：');
            failures.forEach((item) => lines.push(`${String(item?.email || '未知账户')}｜${formatReauthStep(item?.step)}｜${String(item?.error || '未知错误')}`));
          }
          if (skippedItems.length) {
            lines.push('跳过列表：');
            skippedItems.forEach((item) => {
              const fallback = Number.isFinite(Number(item?.position)) ? `巡检结果第 ${Number(item.position) + 1}` : '未知账户';
              lines.push(`${String(item?.email || fallback)}｜${formatSkipReason(item?.reason || item?.error)}`);
            });
          }
          dom.results.hidden = false;
          dom.results.textContent = lines.join('\n');
        }
      }
    }

    function hasRequiredSettings() {
      const settings = collectSettings();
      return Boolean(settings.cpamBaseUrl && settings.cpamAccessToken);
    }

    function updateStartButtonState() {
      if (!dom.btnStart) return;
      const phase = String(lastRuntimeState?.phase || 'idle').trim().toLowerCase() || 'idle';
      dom.btnStart.disabled = startInFlight || ACTIVE_PHASES.has(phase);
    }

    function enqueueSave() {
      const queuedSave = saveQueue.then(
        () => requestSave(),
        () => requestSave()
      );
      saveQueue = queuedSave.catch(() => {});
      return queuedSave;
    }

    function queueInputSave() {
      return enqueueSave();
    }

    function runtimeErrorMessage(error) {
      const message = String(error?.message || error || '启动 CPAM ReAuth 失败。');
      const accessToken = collectSettings().cpamAccessToken;
      return accessToken ? message.split(accessToken).join('[REDACTED]') : message;
    }

    async function start() {
      if (startInFlight) return;
      if (!hasRequiredSettings()) {
        if (dom.summary) dom.summary.textContent = '请填写 CPAM 地址和访问令牌。';
        return;
      }
      const runtimeBeforeStart = lastRuntimeState;
      startInFlight = true;
      render({ ...runtimeBeforeStart, phase: 'initializing' });
      try {
        await enqueueSave();
      } catch {
        startInFlight = false;
        render(runtimeBeforeStart);
        if (dom.summary) dom.summary.textContent = '无法保存 CPAM ReAuth 设置。';
        return;
      }
      try {
        const response = await runtime.sendMessage?.({
          type: 'START_CPAM_REAUTH',
          source: 'sidepanel',
          payload: {},
        });
        if (response?.error) {
          throw new Error(String(response.error));
        }
      } catch (error) {
        startInFlight = false;
        render(runtimeBeforeStart);
        if (dom.summary) dom.summary.textContent = runtimeErrorMessage(error);
      } finally {
        startInFlight = false;
        updateStartButtonState();
      }
    }

    async function stop() {
      try {
        await runtime.sendMessage?.({
          type: 'STOP_CPAM_REAUTH',
          source: 'sidepanel',
          payload: {},
        });
      } catch {
        if (dom.summary) dom.summary.textContent = '无法停止 CPAM ReAuth。';
      }
    }

    async function dispatchTerminalAction(type) {
      try {
        const response = await runtime.sendMessage?.({ type, source: 'sidepanel', payload: {} });
        if (response?.error) throw new Error(String(response.error));
      } catch (error) {
        if (dom.summary) dom.summary.textContent = runtimeErrorMessage(error);
      }
    }

    async function retryFailed() {
      await dispatchTerminalAction('RETRY_CPAM_REAUTH_FAILED');
    }

    async function deleteDeactivated() {
      const items = Array.isArray(lastRuntimeState?.items) ? lastRuntimeState.items : [];
      const count = items.filter((item) => item?.status === 'failed' && /\baccount_deactivated\b/i.test(String(item?.error || '')) && item?.deleteStatus !== 'deleted').length;
      if (!count) return;
      if (await confirmDeleteDeactivated(count)) {
        await dispatchTerminalAction('DELETE_CPAM_REAUTH_DEACTIVATED');
      }
    }

    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;
      [dom.inputBaseUrl, dom.inputAccessToken, dom.inputInspectionRunId, dom.inputReplaceOriginalFile].forEach((input) => {
        input?.addEventListener('input', () => {
          if (startInFlight) return;
          queueInputSave().catch(() => {});
        });
      });
      dom.btnStart?.addEventListener('click', () => start());
      dom.btnStop?.addEventListener('click', () => stop());
      dom.btnRetry?.addEventListener('click', () => retryFailed());
      dom.btnDeleteDeactivated?.addEventListener('click', () => deleteDeactivated());
    }

    return {
      bindEvents,
      render,
      applySettings,
      collectSettings,
    };
  }

  return { createCpamReauthPanel };
});
