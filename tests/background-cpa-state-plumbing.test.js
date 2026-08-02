const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function extractFunction(source, name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }

  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

test('background step-1 state plumbing persists and resets cpa oauth runtime keys', () => {
  const source = fs.readFileSync('background.js', 'utf8');

  assert.match(source, /cpaOAuthState:\s*null/);
  assert.match(source, /cpaManagementOrigin:\s*null/);
  assert.match(source, /payload\.cpaOAuthState[^\n]*updates\.cpaOAuthState/);
  assert.match(source, /payload\.cpaManagementOrigin[^\n]*updates\.cpaManagementOrigin/);

  const harness = new Function(`
function getStepExecutionKeyForState() {
  return '';
}
${extractFunction(source, 'getDownstreamStateResets')}
return { getDownstreamStateResets };
`)();
  const resets = harness.getDownstreamStateResets(1, {});
  assert.equal(resets.cpaOAuthState, null);
  assert.equal(resets.cpaManagementOrigin, null);
});

test('message router step-1 handler stores cpa oauth runtime keys', async () => {
  const source = fs.readFileSync('background/message-router.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundMessageRouter;`)(globalScope);

  const updates = [];
  const router = api.createMessageRouter({
    broadcastDataUpdate: () => {},
    setState: async (payload) => {
      updates.push(payload);
    },
  });

  await router.handleStepData(1, {
    cpaOAuthState: 'oauth-state-1',
    cpaManagementOrigin: 'http://localhost:8317',
  });

  assert.deepStrictEqual(updates, [
    {
      cpaOAuthState: 'oauth-state-1',
      cpaManagementOrigin: 'http://localhost:8317',
    },
  ]);
});
