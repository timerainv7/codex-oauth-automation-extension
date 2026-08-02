(function attachFlowPilotI18nCatalog(root, factory) {
  root.FlowPilotI18nCatalog = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createFlowPilotI18nCatalog() {
  const CATALOG = Object.freeze({
    'zh-CN': Object.freeze({
      'language.auto': 'Auto',
      'language.zh-CN': 'Chinese',
      'language.en-US': 'English',
      'sidepanel.config.menu': '\u914d\u7f6e',
      'sidepanel.config.export': '\u5bfc\u51fa\u914d\u7f6e',
      'sidepanel.config.import': '\u5bfc\u5165\u914d\u7f6e',
      'sidepanel.language.label': '\u8bed\u8a00',
      'sidepanel.language.auto': '\u81ea\u52a8',
      'sidepanel.language.zh-CN': '\u4e2d\u6587',
      'sidepanel.language.en-US': 'English',
    }),
    'en-US': Object.freeze({
      'language.auto': 'Auto',
      'language.zh-CN': 'Chinese',
      'language.en-US': 'English',
      'sidepanel.config.menu': 'Config',
      'sidepanel.config.export': 'Export Config',
      'sidepanel.config.import': 'Import Config',
      'sidepanel.language.label': 'Language',
      'sidepanel.language.auto': 'Auto',
      'sidepanel.language.zh-CN': 'Chinese',
      'sidepanel.language.en-US': 'English',
    }),
  });

  return {
    CATALOG,
  };
});
