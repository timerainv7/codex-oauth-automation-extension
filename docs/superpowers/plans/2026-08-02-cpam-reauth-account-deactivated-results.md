# CPAM ReAuth Account Deactivation and Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect deleted/deactivated OpenAI accounts during CPAM ReAuth OAuth login and preserve a readable terminal result summary with failure and skip details.

**Architecture:** The OpenAI content script turns a verified `account_deactivated` page into an explicit terminal error after password or email-code submission. The CPAM controller associates every node error with the current node, normalizes the deactivation reason, and persists it in `reauthRuntime.items`. The side panel renders that persisted terminal data under the existing CPAM card.

**Tech Stack:** Manifest V3 service worker, vanilla JavaScript content script and side panel, Node built-in test runner.

---

## File structure

- Modify `flows/openai/content/openai-auth.js`: detect OpenAI account deactivation in login-page state and reject both password and email-code paths.
- Modify `background/cpam-reauth-controller.js`: save failure step/reason for every queue item and normalize `account_deactivated`.
- Modify `sidepanel/sidepanel.html`, `sidepanel/cpam-reauth.js`, and `sidepanel/sidepanel.css`: render persistent terminal ReAuth results.
- Modify `tests/cpam-reauth-controller.test.js` and `tests/sidepanel-cpam-reauth.test.js`; create `tests/openai-auth-account-deactivated.test.js` for content-script detection.

### Task 1: Detect account deactivation in the OAuth content script

**Files:**

- Modify: `flows/openai/content/openai-auth.js`
- Create: `tests/openai-auth-account-deactivated.test.js`

- [ ] **Step 1: Write failing deactivation detector tests**

Create a source-extraction test with a fake `document.body.innerText` and URL. It must prove that the detector accepts the code, English, and Chinese page markers while rejecting a normal invalid-password page.

```js
test('OpenAI auth detects account_deactivated from code and localized page text', () => {
  for (const text of [
    'Error code: account_deactivated',
    'You do not have an account because it has been deleted or deactivated.',
    '你没有账户，因为该账户已被删除或停用。',
  ]) {
    assert.equal(createDetector(text).isAccountDeactivatedPage(), true);
  }
  assert.equal(createDetector('Incorrect password.').isAccountDeactivatedPage(), false);
});
```

- [ ] **Step 2: Run the detector test and confirm it fails**

Run: `node --test tests/openai-auth-account-deactivated.test.js`

Expected: failure because `isAccountDeactivatedPage` is not yet available to the extracted harness.

- [ ] **Step 3: Add a single explicit deactivation helper and state**

Near other login-state helpers in `flows/openai/content/openai-auth.js`, add a non-sensitive detector and canonical error factory:

```js
const ACCOUNT_DEACTIVATED_ERROR = 'ACCOUNT_DEACTIVATED::账号已被删除或停用（account_deactivated）';

function isAccountDeactivatedPage() {
  const text = String(document.body?.innerText || document.documentElement?.innerText || '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  return /\baccount_deactivated\b/.test(text)
    || /account (?:has been )?(?:deleted|deactivated)|deleted or deactivated/.test(text)
    || /账户已被删除或停用|账号已被删除或停用/.test(text);
}

function throwIfAccountDeactivated() {
  if (isAccountDeactivatedPage()) throw new Error(ACCOUNT_DEACTIVATED_ERROR);
}
```

Call it before returning a normal `inspectLoginAuthState()` result, and add `account_deactivated_page` to the serialized state when the helper finds the page. Do not include page HTML, request ID, callback URL, or credentials in the error.

- [ ] **Step 4: Make both post-submit paths reject immediately**

Call `throwIfAccountDeactivated()` from the polling loops that follow password submit (`waitForStep6PasswordSubmitTransition`) and verification-code submit (`waitForVerificationSubmitOutcome`) before their normal transition/error recovery logic. The caught content-script command must return the canonical error through its existing `{ error }` message contract.

- [ ] **Step 5: Run focused content tests**

Run: `node --test tests/openai-auth-account-deactivated.test.js tests/auth-page-recovery.test.js tests/step8-state-timeout-retry.test.js`

Expected: all pass; existing retry-page recognition remains unchanged.

### Task 2: Record failure step and preserve queue details

**Files:**

- Modify: `background/cpam-reauth-controller.js`
- Modify: `tests/cpam-reauth-controller.test.js`

- [ ] **Step 1: Write failing controller tests**

Add one test for a deactivated account during `oauth-login`, one during `fetch-login-code`, and one ordinary node failure.

```js
test('ReAuth records account deactivation with its OAuth node and continues the queue', async () => {
  const controller = createCpamReauthController({
    getRunCandidates: async () => ({ candidates: [candidate('gone@example.test'), candidate('ok@example.test')], skipped: [] }),
    getState: async () => validState(), clearOpenAiCookies: async () => {},
    executeNode: async (nodeId, payload) => {
      if (payload.email === 'gone@example.test' && nodeId === 'fetch-login-code') {
        throw new Error('ACCOUNT_DEACTIVATED::账号已被删除或停用（account_deactivated）');
      }
    }, setState: async () => {}, broadcastDataUpdate: () => {},
  });
  const summary = await controller.start();
  const gone = summary.items.find((item) => item.email === 'gone@example.test');
  assert.deepEqual({ status: gone.status, step: gone.step, error: gone.error }, {
    status: 'failed', step: 'fetch-login-code', error: '账号已被删除或停用（account_deactivated）',
  });
  assert.equal(summary.succeeded, 1);
});
```

Also assert an ordinary error becomes `{ status: 'failed', step: 'confirm-oauth', error: '...' }`, and stopped pending items retain `{ status: 'skipped', reason: 'stopped' }`.

- [ ] **Step 2: Run the controller test and confirm it fails**

Run: `node --test tests/cpam-reauth-controller.test.js`

Expected: failure because queue item details have no `step` and retain the raw deactivation error.

- [ ] **Step 3: Attach the executing node to candidate errors**

In `executeCandidate`, wrap each `executeNode(nodeId, ...)` rejection once. Preserve existing stop handling, then throw an error carrying `reauthStep: nodeId`. In the queue-level catch, create the failed item with:

```js
function normalizeReauthFailure(error, fallbackStep) {
  const raw = safeErrorMessage(error);
  if (/\bACCOUNT_DEACTIVATED\b|\baccount_deactivated\b/i.test(raw)) {
    return { step: error?.reauthStep || fallbackStep, error: '账号已被删除或停用（account_deactivated）' };
  }
  return { step: error?.reauthStep || fallbackStep, error: raw };
}
```

Use `normalizeReauthFailure(error, '')` only for the current candidate failure; `executeCandidate` supplies the actual node through `error.reauthStep`. Keep `items` as the sole persisted results list; do not emit callback URLs or tokens in it.

- [ ] **Step 4: Run controller tests**

Run: `node --test tests/cpam-reauth-controller.test.js`

Expected: all pass, including ordering, stop behavior, token redaction, and the new detailed result cases.

### Task 3: Render persistent terminal results in the CPAM card

**Files:**

- Modify: `sidepanel/sidepanel.html`
- Modify: `sidepanel/sidepanel.css`
- Modify: `sidepanel/cpam-reauth.js`
- Modify: `tests/sidepanel-cpam-reauth.test.js`

- [ ] **Step 1: Write failing side-panel rendering tests**

Extend the fake DOM with `results` and test a completed runtime with success, failed, and skipped items:

```js
test('CPAM ReAuth renders terminal summary, full-email failure and skip details', () => {
  const { dom, panel } = createHarness();
  panel.render({ phase: 'completed', queued: 3, succeeded: 1, failed: 1, skipped: 1, items: [
    { email: 'ok@example.test', status: 'succeeded' },
    { email: 'gone@example.test', status: 'failed', step: 'fetch-login-code', error: '账号已被删除或停用（account_deactivated）' },
    { email: 'duplicate@example.test', status: 'skipped', reason: 'duplicate' },
  ] });
  assert.match(dom.results.textContent, /成功 1 个.*失败 1 个.*跳过 1 个/s);
  assert.match(dom.results.textContent, /gone@example\.test/);
  assert.match(dom.results.textContent, /登录验证码/);
  assert.match(dom.results.textContent, /duplicate@example\.test/);
});
```

Add a running-phase assertion that result detail is hidden/empty and a token/callback assertion that rendering only uses `email`, `status`, `step`, `error`, and `reason`.

- [ ] **Step 2: Run the side-panel test and confirm it fails**

Run: `node --test tests/sidepanel-cpam-reauth.test.js`

Expected: failure because the result container and renderer do not exist.

- [ ] **Step 3: Add the result container and narrow styles**

Place this immediately after `#cpam-reauth-summary` in the existing CPAM card:

```html
<div id="cpam-reauth-results" class="cpam-reauth-results" hidden aria-live="polite"></div>
```

Add compact styles for `.cpam-reauth-results`, `.cpam-reauth-result-title`, and `.cpam-reauth-result-list` that wrap long reason text without changing other data cards.

- [ ] **Step 4: Render terminal detail using DOM nodes, not HTML interpolation**

Pass `results: document.getElementById('cpam-reauth-results')` to `createCpamReauthPanel`. In its `render(runtimeState)`, clear the container on active phases; for `completed`, `stopped`, or `failed`, append:

```js
appendText(results, `本次结果：成功 ${succeeded} 个，失败 ${failed} 个，跳过 ${skipped} 个`);
appendGroup(results, '失败列表', items.filter((item) => item.status === 'failed'), (item) =>
  `${item.email}｜${formatReauthStep(item.step)}｜${item.error || '未知错误'}`);
appendGroup(results, '跳过列表', items.filter((item) => item.status === 'skipped'), (item) =>
  `${item.email || '巡检结果第 ' + (Number(item.position) + 1)}｜${formatSkipReason(item.reason || item.error)}`);
```

Use `textContent` for all user/data-derived strings. Map `oauth-login` to “OAuth 登录”, `fetch-login-code` to “登录验证码”, `post-login-phone-verification` to “登录后手机号验证”, `confirm-oauth` to “确认 OAuth”, and `platform-verify` to “CPA 回调验证”. Map `duplicate`, `invalid_email`, and `stopped` to Chinese reason labels.

- [ ] **Step 5: Run side-panel tests**

Run: `node --test tests/sidepanel-cpam-reauth.test.js tests/sidepanel-contribution-mode.test.js`

Expected: all pass; extraction guards for `cpamReauthPanel` remain intact.

### Task 4: Run integrated verification

**Files:**

- Modify only if a failing regression identifies an issue in the files above.

- [ ] **Step 1: Run syntax checks and all CPAM-focused tests**

Run: `node --check flows/openai/content/openai-auth.js; node --check background/cpam-reauth-controller.js; node --check sidepanel/cpam-reauth.js; node --test tests/openai-auth-account-deactivated.test.js tests/cpam-reauth-controller.test.js tests/sidepanel-cpam-reauth.test.js tests/background-cpam-reauth-router.test.js`

Expected: every command exits 0.

- [ ] **Step 2: Run the full suite**

Run: `npm test`

Expected: zero failures.

- [ ] **Step 3: Manual extension verification**

1. Trigger an OpenAI `account_deactivated` page after password submit; confirm its ReAuth item fails at “OAuth 登录” and the next candidate starts.
2. Trigger the same page after submitting an email verification code; confirm the item fails at “登录验证码” and the next candidate starts.
3. Let a mixed run finish; confirm the card displays full emails, terminal counts, failure details, and skip details.
4. Confirm the card, activity log, and persisted runtime do not display the CPAM Access Token or a localhost callback URL.

- [ ] **Step 4: Commit the completed task**

This workspace has no `.git` directory. Record changed files and verification output in the final handoff instead of attempting a commit.
