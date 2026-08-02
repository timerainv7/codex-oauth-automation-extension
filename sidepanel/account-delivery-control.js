(function attachSidepanelAccountDeliveryControl(globalScope) {
  const accountDeliveryApi = globalScope.MultiPageOpenAiAccountDelivery || {};

  function createAccountDeliveryControl(options = {}) {
    const {
      row = null,
      select = null,
      caption = null,
      onChange = null,
    } = options;

    let destroyed = false;
    let renderedTargetId = '';
    let renderedModeId = '';
    let renderedModeIds = [];

    function getModeOptions(modeIds) {
      if (typeof accountDeliveryApi.getAccountDeliveryModeOptions !== 'function') {
        return [];
      }
      return accountDeliveryApi.getAccountDeliveryModeOptions(modeIds);
    }

    function normalizeModeId(modeId, fallback) {
      if (typeof accountDeliveryApi.normalizeAccountDeliveryMode === 'function') {
        return accountDeliveryApi.normalizeAccountDeliveryMode(modeId, fallback);
      }
      const normalized = String(modeId || '').trim().toLowerCase();
      return renderedModeIds.includes(normalized) ? normalized : fallback;
    }

    function replaceOptions(modeOptions) {
      if (!select) {
        return;
      }
      const documentRef = select.ownerDocument || globalScope.document;
      const optionNodes = modeOptions.map((mode) => {
        const option = documentRef.createElement('option');
        option.value = mode.id;
        option.textContent = mode.label;
        return option;
      });
      select.replaceChildren(...optionNodes);
    }

    function render(capabilityState = {}) {
      if (destroyed) {
        return;
      }
      const requestedModeIds = Array.isArray(capabilityState.availableAccountDeliveryModes)
        ? capabilityState.availableAccountDeliveryModes
        : [];
      const modeOptions = getModeOptions(requestedModeIds);
      renderedModeIds = modeOptions.map((mode) => mode.id);
      const fallbackModeId = renderedModeIds[0] || '';
      const normalizedModeId = normalizeModeId(
        capabilityState.effectiveAccountDeliveryMode,
        fallbackModeId
      );
      renderedModeId = renderedModeIds.includes(normalizedModeId)
        ? normalizedModeId
        : fallbackModeId;
      renderedTargetId = String(
        capabilityState.effectiveTargetId || capabilityState.targetId || ''
      ).trim().toLowerCase();

      const visible = Boolean(capabilityState.canShowAccountDeliveryControl);
      const editable = visible && Boolean(capabilityState.canEditAccountDeliveryMode);
      if (row?.style) {
        row.style.display = visible ? '' : 'none';
      }

      replaceOptions(modeOptions);
      if (select) {
        select.value = renderedModeId;
        select.disabled = !editable;
        select.setAttribute?.('aria-disabled', String(select.disabled));
      }

      if (caption) {
        const definition = typeof accountDeliveryApi.getAccountDeliveryModeDefinition === 'function'
          ? accountDeliveryApi.getAccountDeliveryModeDefinition(renderedModeId)
          : null;
        caption.textContent = definition?.description || '';
      }
    }

    function handleChange(event) {
      if (destroyed || typeof onChange !== 'function') {
        return;
      }
      const selectedModeId = normalizeModeId(
        event?.currentTarget?.value ?? select?.value,
        renderedModeId
      );
      const accountDeliveryMode = renderedModeIds.includes(selectedModeId)
        ? selectedModeId
        : renderedModeId;
      onChange({
        targetId: renderedTargetId,
        accountDeliveryMode,
      });
    }

    function destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      select?.removeEventListener?.('change', handleChange);
    }

    select?.addEventListener?.('change', handleChange);

    return {
      destroy,
      render,
    };
  }

  globalScope.SidepanelAccountDeliveryControl = {
    createAccountDeliveryControl,
  };
})(window);
