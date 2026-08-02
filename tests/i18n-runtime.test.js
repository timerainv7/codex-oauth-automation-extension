const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const catalogSource = fs.readFileSync('shared/i18n/catalog.js', 'utf8');
const runtimeSource = fs.readFileSync('shared/i18n/runtime.js', 'utf8');
const staticSidepanelSource = fs.readFileSync('sidepanel/i18n-static.js', 'utf8');

function loadI18n(navigator = { language: 'zh-CN' }) {
  const scope = { navigator };
  new Function('self', `${catalogSource}; ${runtimeSource};`)(scope);
  return scope.FlowPilotI18n;
}

test('i18n normalizes supported language settings', () => {
  const i18n = loadI18n();

  assert.equal(i18n.normalizeLanguageSetting('auto'), 'auto');
  assert.equal(i18n.normalizeLanguageSetting('en'), 'en-US');
  assert.equal(i18n.normalizeLanguageSetting('en_GB'), 'en-US');
  assert.equal(i18n.normalizeLanguageSetting('zh'), 'zh-CN');
  assert.equal(i18n.normalizeLanguageSetting('zh-Hans'), 'zh-CN');
  assert.equal(i18n.normalizeLanguageSetting('bad'), 'auto');
});

test('i18n resolves auto from browser language and falls back safely', () => {
  assert.equal(loadI18n({ language: 'en-US' }).resolveLocale('auto'), 'en-US');
  assert.equal(loadI18n({ language: 'zh-CN' }).resolveLocale('auto'), 'zh-CN');
  assert.equal(loadI18n({ language: 'fr-FR' }).resolveLocale('auto'), 'zh-CN');
});

test('i18n resolves auto from chrome UI language before navigator language', () => {
  const scope = {
    chrome: {
      i18n: {
        getUILanguage: () => 'en-GB',
      },
    },
    navigator: {
      language: 'zh-CN',
      languages: ['zh-CN'],
    },
  };
  new Function('self', `${catalogSource}; ${runtimeSource};`)(scope);

  assert.equal(scope.FlowPilotI18n.resolveLocale('auto', scope), 'en-US');
});

test('i18n translates catalog entries with fallback and interpolation', () => {
  const i18n = loadI18n({ language: 'en-US' });

  assert.equal(i18n.t('sidepanel.language.label', {}, { locale: 'en-US' }), 'Language');
  assert.equal(i18n.t('missing.key', {}, { locale: 'en-US', fallback: 'Fallback' }), 'Fallback');
  assert.equal(i18n.t('', {}, { locale: 'en-US', fallback: 'Empty' }), 'Empty');
  assert.equal(i18n.t('custom', { value: 3 }, { fallback: 'Value {value}' }), 'Value 3');
});

function loadSidepanelStaticI18n() {
  const scope = {};
  new Function('self', `${staticSidepanelSource};`)(scope);
  return scope.FlowPilotSidepanelI18n;
}

test('sidepanel static i18n translates and restores known strings', () => {
  const i18n = loadSidepanelStaticI18n();

  assert.equal(i18n.translateValue('\u914d\u7f6e', 'en-US'), 'Config');
  assert.equal(i18n.translateValue('\u914d\u7f6e', 'zh-CN'), '\u914d\u7f6e');
  assert.equal(i18n.translateValue('  \u6ce8\u518c  ', 'en-US'), '  Sign Up  ');
  assert.equal(i18n.translateValue('\u672a\u6536\u5f55\u6587\u6848', 'en-US'), '\u672a\u6536\u5f55\u6587\u6848');
});

test('sidepanel static i18n translates account delivery metadata', () => {
  const i18n = loadSidepanelStaticI18n();

  assert.equal(i18n.translateValue('\u8d26\u53f7\u4ea4\u4ed8', 'en-US'), 'Account Delivery');
  assert.equal(
    i18n.translateValue('\u901a\u8fc7\u76ee\u6807\u5e73\u53f0 OAuth \u6388\u6743\u4ea4\u4ed8\u8d26\u53f7', 'en-US'),
    'Deliver account through target platform OAuth authorization'
  );
  assert.equal(
    i18n.translateValue('\u8bfb\u53d6\u5f53\u524d ChatGPT \u767b\u5f55\u4f1a\u8bdd\u5e76\u5bfc\u5165\u76ee\u6807\u5e73\u53f0', 'en-US'),
    'Read the current ChatGPT session and import it into the target platform'
  );
  assert.equal(
    i18n.translateValue('\u6ce8\u518c\u672c\u5730 Agent Identity \u540e\u5bfc\u5165\u76ee\u6807\u5e73\u53f0', 'en-US'),
    'Register a local Agent Identity and import it into the target platform'
  );
});

test('sidepanel static i18n translates dynamic user-facing patterns', () => {
  const i18n = loadSidepanelStaticI18n();

  assert.equal(i18n.translateValue('\u6ce8\u518c\u5e76\u8f93\u5165\u90ae\u7bb1', 'en-US'), 'Sign up and enter email');
  assert.equal(i18n.translateValue('\u8282\u70b9 platform-verify \u8fd0\u884c\u4e2d...', 'en-US'), 'Node platform-verify running...');
  assert.equal(i18n.translateValue('\u81ea\u52a8\u5df2\u6682\u505c (2/5)\uff0c\u7b49\u5f85\u90ae\u7bb1\u540e\u7ee7\u7eed', 'en-US'), 'Auto paused (2/5), waiting for email to continue');
  assert.equal(i18n.translateValue('\u5f53\u524d FlowPilot2.5\uff0c\u5171\u6709 2 \u4e2a\u65b0\u7248\u672c\u53ef\u66f4\u65b0\u3002', 'en-US'), 'Current FlowPilot2.5, 2 new versions available.');
  assert.equal(i18n.translateValue('\u7b49\u5f85\u4e2d (3\u8f6e)', 'en-US'), 'Waiting (3 rounds)');
  assert.equal(i18n.translateValue('\u8fd0\u884c\u4e2d (2\u8f6e \u00b7 \u5c1d\u8bd52)', 'en-US'), 'Running (2 rounds / attempt 2)');
});

test('sidepanel static i18n translates toast and log display patterns', () => {
  const i18n = loadSidepanelStaticI18n();

  assert.equal(i18n.translateValue('\u4fe1\u606f', 'en-US'), 'Info');
  assert.equal(i18n.translateValue('\u6b65' + '3', 'en-US'), 'Step 3');
  assert.equal(
    i18n.translateValue('\u6b65\u9aa4 4\uff1a\u6b63\u5728\u901a\u8fc7 LuckMail \u8f6e\u8be2\u9a8c\u8bc1\u7801\uff081/20\uff09...', 'en-US'),
    'Step 4: Polling verification code via LuckMail (1/20)...'
  );
  assert.equal(i18n.translateValue('\u4fdd\u5b58\u5931\u8d25\uff1anetwork error', 'en-US'), 'Save failed: network error');
  assert.equal(i18n.translateValue('\u6253\u5f00Gmail \u90ae\u7bb1\u5931\u8d25\uff1atab error', 'en-US'), 'Failed to open Gmail: tab error');
});
