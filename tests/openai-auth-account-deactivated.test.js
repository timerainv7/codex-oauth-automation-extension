const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('flows/openai/content/openai-auth.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers.map((marker) => source.indexOf(marker)).find((index) => index >= 0);
  if (start === undefined) throw new Error(`missing function ${name}`);

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '(') parenDepth += 1;
    if (source[index] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) signatureEnded = true;
    }
    if (signatureEnded && source[index] === '{') {
      braceStart = index;
      break;
    }
  }
  if (braceStart < 0) throw new Error(`missing body for function ${name}`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`missing body for function ${name}`);
}

function createDetector(text) {
  return new Function('document', `
    ${extractFunction('isAccountDeactivatedPage')}
    return { isAccountDeactivatedPage };
  `)({
    body: { innerText: text },
    documentElement: { innerText: text },
  });
}

test('OpenAI auth detects account_deactivated from code and localized page text', () => {
  [
    'Error code: account_deactivated',
    'You do not have an account because it has been deleted or deactivated.',
    '你没有账户，因为该账户已被删除或停用。',
  ].forEach((text) => {
    assert.equal(createDetector(text).isAccountDeactivatedPage(), true);
  });
  assert.equal(createDetector('Incorrect password.').isAccountDeactivatedPage(), false);
});

test('password and login-code post-submit waits check for account deactivation', () => {
  assert.match(extractFunction('waitForStep6PostSubmitTransition'), /throwIfAccountDeactivated\(\)/);
  assert.match(extractFunction('waitForVerificationSubmitOutcome'), /throwIfAccountDeactivated\(\)/);
});
