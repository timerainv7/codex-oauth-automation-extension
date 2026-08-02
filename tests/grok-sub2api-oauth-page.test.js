const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('flows/grok/content/sub2api-oauth-page.js', 'utf8');

function loadApi() {
  const scope = {};
  return new Function('self', `${source}; return self.MultiPageGrokSub2ApiOAuthPage;`)(scope);
}

test('Grok SUB2API OAuth page detects Chinese and English consent actions', () => {
  const api = loadApi();

  assert.deepEqual(api.classifyPageSnapshot({
    pageText: '授权 Grok Build Verify your identity',
    actionTexts: ['拒绝', '允许'],
    codeCandidates: [],
  }), {
    state: 'consent_page',
    actionIndex: 1,
  });
  assert.deepEqual(api.classifyPageSnapshot({
    pageText: 'Authorize Grok Build Verify your identity',
    actionTexts: ['Deny', 'Allow'],
    codeCandidates: [],
  }), {
    state: 'consent_page',
    actionIndex: 1,
  });
});

test('Grok SUB2API OAuth page prioritizes a visible allow action over code-like consent copy', () => {
  const api = loadApi();

  assert.deepEqual(api.classifyPageSnapshot({
    pageText: '授权 Grok Build 输入此代码以完成登录',
    actionTexts: ['拒绝', '允许'],
    codeCandidates: [],
  }), {
    state: 'consent_page',
    actionIndex: 1,
  });
});

test('Grok SUB2API OAuth page reads only a visible code-page value', () => {
  const api = loadApi();
  const code = 'ilUTmu195dD7ZtMI-huPjKMXjR65M6K-dloR3XzL1vTnypRYqC';

  assert.deepEqual(api.classifyPageSnapshot({
    pageText: '输入此代码以完成登录 将下面的代码复制到 Grok Build 以完成登录。',
    actionTexts: [],
    codeCandidates: ['', code],
  }), {
    state: 'code_page',
    code,
  });
  assert.deepEqual(api.classifyPageSnapshot({
    pageText: 'Unrelated settings page',
    actionTexts: [],
    codeCandidates: [code],
  }), {
    state: 'loading',
  });
});

test('Grok SUB2API OAuth content driver never uses the clipboard API', () => {
  assert.doesNotMatch(source, /navigator\.clipboard|clipboardData|execCommand\(['"]copy/);
});

test('Grok SUB2API OAuth error state does not return page text that may contain a code', () => {
  const api = loadApi();
  const code = 'ilUTmu195dD7ZtMI-huPjKMXjR65M6K-dloR3XzL1vTnypRYqC';

  const result = api.classifyPageSnapshot({
    pageText: `Authorization failed. Diagnostic code: ${code}`,
    actionTexts: [],
    codeCandidates: [code],
  });

  assert.deepEqual(result, {
    state: 'error_page',
    error: 'Grok OAuth 授权页面显示失败。',
  });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(code));
});

test('Grok SUB2API OAuth page reads action and code values without concatenating accessibility labels', () => {
  const api = loadApi();
  const code = 'ilUTmu195dD7ZtMI-huPjKMXjR65M6K-dloR3XzL1vTnypRYqC';
  const element = (values) => ({
    ...values,
    getAttribute(name) {
      return values[name] || '';
    },
  });

  assert.equal(api.getActionText(element({ textContent: 'Allow', 'aria-label': 'Authorize Grok Build' })), 'Allow');
  assert.equal(api.getCodeCandidate(element({ value: code, 'aria-label': 'Copy code' })), code);
});
