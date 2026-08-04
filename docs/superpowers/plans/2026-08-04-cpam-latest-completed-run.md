# CPAM ReAuth Latest Completed Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let CPAM ReAuth automatically use the newest completed inspection when the optional inspection-run ID is blank.

**Architecture:** Keep `background/cpam-inspection-api.js` as the sole CPAM transport and candidate-filtering boundary. It will resolve an optional ID to a completed run, then use the existing detail endpoint and 401 candidate extraction. The side panel will make the ID optional while preserving the existing settings persistence and start sequencing.

**Tech Stack:** Manifest V3 extension, vanilla JavaScript, Node built-in test runner.

---

## File structure

- Modify `background/cpam-inspection-api.js`: resolve a blank run ID through CPAM's runs-list endpoint before loading run details.
- Modify `tests/cpam-inspection-api.test.js`: cover manual IDs, automatic completed-run selection, malformed responses, and errors.
- Modify `sidepanel/cpam-reauth.js`: only require CPAM URL and access token before starting.
- Modify `sidepanel/sidepanel.html`: state that the run ID is optional and leave the field's existing numeric constraints intact.
- Modify `tests/sidepanel-cpam-reauth.test.js`: verify blank-ID startup and the optional-field explanation.
- Modify `tests/background-cpam-reauth-router.test.js`: keep persistence normalization coverage for both supplied and empty IDs.

### Task 1: Resolve a blank run ID in the CPAM API layer

**Files:**

- Modify: `background/cpam-inspection-api.js`
- Test: `tests/cpam-inspection-api.test.js`

- [ ] **Step 1: Write failing automatic-selection tests**

Add a `getRunCandidates` test with `cpamInspectionRunId: ''` and a recording `fetchImpl`. Return the following list payload from the first request and a valid detail payload from the second request:

```js
{ items: [
  { id: 48, status: 'running' },
  { id: 47, status: 'completed' },
] }
```

Assert the requests are exactly:

```js
[
  'https://cpam.example.test/v0/management/codex-inspection/runs?limit=20',
  'https://cpam.example.test/v0/management/codex-inspection/runs/47',
]
```

and assert the returned `run.id` is `47`. Add a separate failure assertion where `items` contains no completed run:

```js
await assert.rejects(
  () => api.getRunCandidates(validSettings({ cpamInspectionRunId: '' })),
  /没有可用的已完成巡检/
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cpam-inspection-api.test.js`

Expected: FAIL because the current `normalizeRunId('')` rejects blank IDs.

- [ ] **Step 3: Write minimal resolver implementation**

Inside `createCpamInspectionApi`, add `requestJson(path, token)` to issue the existing GET headers, parse JSON once, and preserve the existing non-2xx error message. Add `resolveRunId(baseUrl, token, rawRunId)`:

```js
const suppliedRunId = normalizeString(rawRunId);
if (suppliedRunId) return normalizeRunId(suppliedRunId);

const listPayload = await requestJson(
  `${baseUrl}/v0/management/codex-inspection/runs?limit=20`,
  token
);
const latestCompleted = Array.isArray(listPayload?.items)
  ? listPayload.items.find((item) => item?.status === 'completed' && /^\d+$/.test(String(item?.id || '')))
  : null;
if (!latestCompleted) throw new Error('CPAM 没有可用的已完成巡检运行。');
return normalizeRunId(latestCompleted.id);
```

Use the resolved ID for the existing detail request. Do not expose the access token in returned data or errors. Preserve the current return shape `{ run, candidates, skipped }` so the controller needs no changes.

- [ ] **Step 4: Add response-shape and manual-ID regression cases**

Extend the validation test with a list response `{ items: 'invalid' }`, an empty `items` list, and a list whose `completed` item has an invalid ID; each must reject with `/没有可用的已完成巡检/`. Keep the existing manual-ID request assertion and explicitly assert that a supplied ID makes only one detail request.

- [ ] **Step 5: Run test to verify it passes and commit**

Run: `node --test tests/cpam-inspection-api.test.js`

Expected: PASS.

Commit:

```powershell
git add -- background/cpam-inspection-api.js tests/cpam-inspection-api.test.js
git commit -m "feat: select latest completed CPAM inspection"
```

### Task 2: Make the run ID optional in the side panel

**Files:**

- Modify: `sidepanel/cpam-reauth.js`
- Modify: `sidepanel/sidepanel.html`
- Test: `tests/sidepanel-cpam-reauth.test.js`

- [ ] **Step 1: Write failing panel behavior tests**

Add a test that clears `dom.inputInspectionRunId.value`, binds events, clicks start, and asserts the normal save-then-`START_CPAM_REAUTH` sequence still occurs. Update the missing-settings test to assert this exact message when only the access token is missing:

```js
'请填写 CPAM 地址和访问令牌。'
```

In the markup test, assert the inspection field retains `type="number"`, `min="1"`, and `step="1"`, but its enclosing card includes the literal hint `留空自动使用最新已完成巡检`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sidepanel-cpam-reauth.test.js`

Expected: FAIL because `hasRequiredSettings()` currently requires `cpamInspectionRunId`.

- [ ] **Step 3: Write minimal panel implementation**

Change the panel validation to:

```js
function hasRequiredSettings() {
  const settings = collectSettings();
  return Boolean(settings.cpamBaseUrl && settings.cpamAccessToken);
}
```

Change the local validation summary to `请填写 CPAM 地址和访问令牌。`. In `sidepanel/sidepanel.html`, change the ID label to `检查运行 ID（可选）` and add a `setting-caption` immediately after its input containing `留空自动使用最新已完成巡检`.

- [ ] **Step 4: Run test to verify it passes and commit**

Run: `node --test tests/sidepanel-cpam-reauth.test.js`

Expected: PASS, including existing input-save ordering, active-state locking, token redaction, and result rendering tests.

Commit:

```powershell
git add -- sidepanel/cpam-reauth.js sidepanel/sidepanel.html tests/sidepanel-cpam-reauth.test.js
git commit -m "feat: allow CPAM ReAuth without run ID"
```

### Task 3: Verify persisted optional settings and full integration

**Files:**

- Modify: `tests/background-cpam-reauth-router.test.js`
- Modify only if a verification failure identifies a regression in the files above.

- [ ] **Step 1: Add empty-ID persistence regression coverage**

Extend `generic persistent settings normalize CPAM values for saving` to call `buildPersistentSettingsPayload` with an empty `cpamInspectionRunId` and assert it persists as an empty string without calling the run-ID normalizer:

```js
assert.deepEqual(api.buildPersistentSettingsPayload({ cpamInspectionRunId: '   ' }), {
  cpamBaseUrl: '',
  cpamAccessToken: '',
  cpamInspectionRunId: '',
});
```

- [ ] **Step 2: Run focused regression tests**

Run:

```powershell
node --test tests/cpam-inspection-api.test.js tests/sidepanel-cpam-reauth.test.js tests/background-cpam-reauth-router.test.js
```

Expected: PASS.

- [ ] **Step 3: Run syntax and full-suite verification**

Run:

```powershell
node --check background/cpam-inspection-api.js
node --check sidepanel/cpam-reauth.js
npm test
```

Expected: every command exits with code 0.

- [ ] **Step 4: Commit test-only changes and inspect the branch**

Commit (only if Task 3 changed files):

```powershell
git add -- tests/background-cpam-reauth-router.test.js
git commit -m "test: cover optional CPAM inspection run ID"
```

Then run:

```powershell
git status --short
git log --oneline origin/dev..HEAD
```

Expected: no uncommitted changes and the feature commits are ready to push to `origin/dev`.

