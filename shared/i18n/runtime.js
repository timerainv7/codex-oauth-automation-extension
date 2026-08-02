(function attachFlowPilotI18n(root, factory) {
  root.FlowPilotI18n = factory(root.FlowPilotI18nCatalog);
})(typeof self !== 'undefined' ? self : globalThis, function createFlowPilotI18n(catalogModule) {
  const rootScope = typeof self !== 'undefined' ? self : globalThis;
  const DEFAULT_LOCALE = 'zh-CN';
  const FALLBACK_LOCALE = 'zh-CN';
  const SUPPORTED_LOCALES = Object.freeze(['zh-CN', 'en-US']);
  const SUPPORTED_LOCALE_SET = new Set(SUPPORTED_LOCALES);
  const CATALOG = catalogModule?.CATALOG || {};

  function normalizeLocale(value = '', fallback = DEFAULT_LOCALE) {
    const raw = String(value || '').trim();
    if (!raw) {
      return fallback;
    }
    const lower = raw.replace(/_/g, '-').toLowerCase();
    if (lower === 'auto') {
      return 'auto';
    }
    if (lower === 'en' || lower.startsWith('en-')) {
      return 'en-US';
    }
    if (lower === 'zh' || lower === 'zh-cn' || lower === 'zh-hans' || lower.startsWith('zh-hans-')) {
      return 'zh-CN';
    }
    if (lower === 'zh-sg' || lower === 'zh-my') {
      return 'zh-CN';
    }
    return SUPPORTED_LOCALE_SET.has(raw) ? raw : fallback;
  }

  function getBrowserLocale(rootLike = rootScope) {
    const chromeUiLanguage = typeof rootLike?.chrome?.i18n?.getUILanguage === 'function'
      ? rootLike.chrome.i18n.getUILanguage()
      : '';
    const language = chromeUiLanguage
      || (Array.isArray(rootLike?.navigator?.languages) ? rootLike.navigator.languages[0] : '')
      || rootLike?.navigator?.language
      || '';
    return normalizeLocale(language, DEFAULT_LOCALE);
  }

  function resolveLocale(value = 'auto', rootLike = rootScope) {
    const normalized = normalizeLocale(value, 'auto');
    if (normalized === 'auto') {
      return getBrowserLocale(rootLike);
    }
    return normalized;
  }

  function normalizeLanguageSetting(value = 'auto') {
    const normalized = normalizeLocale(value, 'auto');
    return normalized === 'auto' ? 'auto' : resolveLocale(normalized);
  }

  function interpolate(template = '', params = {}) {
    return String(template || '').replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, key) => {
      if (!Object.prototype.hasOwnProperty.call(params || {}, key)) {
        return match;
      }
      const value = params[key];
      return value === undefined || value === null ? '' : String(value);
    });
  }

  function t(key = '', params = {}, options = {}) {
    const normalizedKey = String(key || '').trim();
    const locale = resolveLocale(options.locale || options.language || 'auto', options.root || rootScope);
    const fallback = options.fallback;
    if (!normalizedKey) {
      return fallback === undefined ? '' : String(fallback);
    }
    const template = CATALOG?.[locale]?.[normalizedKey]
      ?? CATALOG?.[FALLBACK_LOCALE]?.[normalizedKey]
      ?? fallback
      ?? normalizedKey;
    return interpolate(template, params);
  }

  function getElementOriginalValue(element, attrName, currentValue = '') {
    const sourceAttr = `data-i18n-original-${attrName}`;
    if (!element.hasAttribute(sourceAttr)) {
      element.setAttribute(sourceAttr, currentValue);
    }
    return element.getAttribute(sourceAttr) || '';
  }

  function applyDomI18n(rootNode, options = {}) {
    const scope = rootNode?.querySelectorAll ? rootNode : null;
    if (!scope) {
      return;
    }
    const locale = resolveLocale(options.locale || options.language || 'auto', options.root || rootScope);
    scope.querySelectorAll('[data-i18n]').forEach((element) => {
      const key = element.getAttribute('data-i18n') || '';
      const fallback = getElementOriginalValue(element, 'text', element.textContent || '');
      element.textContent = t(key, {}, { locale, fallback });
    });
    [
      ['data-i18n-title', 'title'],
      ['data-i18n-aria-label', 'aria-label'],
      ['data-i18n-placeholder', 'placeholder'],
    ].forEach(([keyAttr, targetAttr]) => {
      scope.querySelectorAll(`[${keyAttr}]`).forEach((element) => {
        const key = element.getAttribute(keyAttr) || '';
        const fallback = getElementOriginalValue(element, targetAttr, element.getAttribute(targetAttr) || '');
        element.setAttribute(targetAttr, t(key, {}, { locale, fallback }));
      });
    });
  }

  return {
    DEFAULT_LOCALE,
    SUPPORTED_LOCALES,
    applyDomI18n,
    normalizeLanguageSetting,
    normalizeLocale,
    resolveLocale,
    t,
  };
});
