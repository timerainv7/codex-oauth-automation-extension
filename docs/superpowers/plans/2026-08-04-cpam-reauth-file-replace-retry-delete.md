# CPAM ReAuth File Replacement, Retry, and Deactivated-Account Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely replace each original CPA 401 credential after successful ReAuth (enabled by default), and provide post-run retry and deactivated-account deletion actions.

**Architecture:** `background/cpa-api.js` owns all CPA auth-file HTTP access. `background/cpam-reauth-controller.js` snapshots pre-OAuth files, coordinates safe replacement and owns immutable candidate ordering plus terminal action state. The side panel persists the replacement setting and dispatches explicit retry/delete messages only after a completed run.

**Tech Stack:** Manifest V3 service worker, vanilla JavaScript, Node built-in test runner.

---

## File structure

- Modify `background/cpa-api.js`, `tests/cpa-api.test.js`: list/download/overwrite/delete CPA auth files without logging contents.
- Modify `background/cpam-reauth-controller.js`, `tests/cpam-reauth-controller.test.js`: safe file replacement, frozen retry candidates, and sequential deletion state.
- Modify `background/message-router.js`, `background.js`, `tests/background-cpam-reauth-router.test.js`: wire actions and persisted default-on setting.
- Modify `sidepanel/cpam-reauth.js`, `sidepanel/sidepanel.html`, `sidepanel/sidepanel.js`, `tests/sidepanel-cpam-reauth.test.js`: switch, terminal buttons, confirmation and result rendering.
- Modify `sidepanel/i18n-static.js`, `tests/i18n-runtime.test.js` only for newly introduced user-visible strings.

### Task 1: Add bounded CPA auth-file API operations

**Files:**

- Modify: `background/cpa-api.js`
- Modify: `tests/cpa-api.test.js`

- [ ] **Step 1: Write failing API tests**

Add tests for four methods created by `createCpaApi`:

```js
await api.listAuthFiles(state);
await api.downloadAuthFile(state, 'new.json');
await api.overwriteAuthFile(state, 'old.json', { type: 'codex', email: 'a@example.test' });
await api.deleteAuthFile(state, 'old.json');
```

Assert URL/method pairs are:

```js
GET    /v0/management/auth-files
GET    /v0/management/auth-files/download?name=new.json
POST   /v0/management/auth-files?name=old.json
DELETE /v0/management/auth-files?name=old.json
```

All calls must use both existing management-key headers. Download must parse JSON content but never include it in an error. Test HTTP 4xx and AbortError paths.

- [ ] **Step 2: Run the focused API test and confirm it fails**

Run: `node --test tests/cpa-api.test.js`

Expected: FAIL because the four auth-file methods do not exist.

- [ ] **Step 3: Implement raw and JSON CPA request boundaries**

Add a private `fetchCpaManagementResponse(origin, path, options)` that shares timeout, management-key headers, and non-2xx error extraction with `fetchCpaManagementJson`. Build:

```js
async function listAuthFiles(state, options = {}) {
  const origin = deriveCpaManagementOrigin(state?.vpsUrl);
  const payload = await fetchCpaManagementJson(origin, '/v0/management/auth-files', {
    method: 'GET', managementKey: normalizeString(state?.vpsPassword), ...options,
  });
  if (!Array.isArray(payload?.files)) throw new Error('CPA 认证文件列表响应无效。');
  return payload.files;
}
```

`downloadAuthFile` requests `/auth-files/download?name=` and parses response JSON; `overwriteAuthFile` sends the JSON credential object to `POST /auth-files?name=`; `deleteAuthFile` sends `DELETE /auth-files?name=`. Reject blank, slash-containing, or non-`.json` names before a request.

- [ ] **Step 4: Run tests and commit**

Run: `node --test tests/cpa-api.test.js && node --check background/cpa-api.js`

Expected: PASS.

Commit:

```powershell
git add -- background/cpa-api.js tests/cpa-api.test.js
git commit -m "feat: add CPA auth file management API"
```

### Task 2: Persist the default-on replacement setting and wire CPA actions

**Files:**

- Modify: `background.js`
- Modify: `tests/background-cpam-reauth-router.test.js`

- [ ] **Step 1: Write failing persistence/wiring tests**

Extend the default-state extraction to require:

```js
cpamReauthReplaceOriginalFile: true,
```

and assert saving `false` remains false. Add source/wiring assertions that the controller receives functions named `listAuthFiles`, `downloadAuthFile`, `overwriteAuthFile`, and `deleteAuthFile`.

- [ ] **Step 2: Run the router test and confirm it fails**

Run: `node --test tests/background-cpam-reauth-router.test.js`

Expected: FAIL because the setting and CPA-file dependencies are absent.

- [ ] **Step 3: Implement default and dependency injection**

Add `cpamReauthReplaceOriginalFile: true` to `DEFAULT_STATE`, normalize it as a boolean in persistent settings, and pass wrappers around the new `MultiPageBackgroundCpaApi.createCpaApi(...)` methods into `createCpamReauthController`. Do not pass management keys or file bodies through runtime state.

- [ ] **Step 4: Run tests and commit**

Run: `node --test tests/background-cpam-reauth-router.test.js`

Expected: PASS.

Commit:

```powershell
git add -- background.js tests/background-cpam-reauth-router.test.js
git commit -m "feat: configure CPAM ReAuth file replacement"
```

### Task 3: Safely replace original credentials after OAuth

**Files:**

- Modify: `background/cpam-reauth-controller.js`
- Modify: `tests/cpam-reauth-controller.test.js`

- [ ] **Step 1: Write failing controller tests**

Create a harness with candidates containing `fileName`, `email`, and `accountId`, then assert this order when replacement is enabled:

```js
listAuthFiles() // baseline before OAuth
executeNode(... 'platform-verify')
listAuthFiles() // poll sees new.json
downloadAuthFile('new.json')
overwriteAuthFile('old.json', downloadedCredential)
deleteAuthFile('new.json')
```

Assert replacement is skipped entirely when `cpamReauthReplaceOriginalFile: false`. Add cases where the poll times out, download fails, overwrite fails, or cleanup fails: each must retain `old.json`, mark that item `failed` with step `cpa-file-replace`, and never call `deleteAuthFile('old.json')`.

- [ ] **Step 2: Run the focused controller test and confirm it fails**

Run: `node --test tests/cpam-reauth-controller.test.js`

Expected: FAIL because the controller currently ends after `platform-verify`.

- [ ] **Step 3: Implement baseline, matching, and fail-closed replacement**

Before the OAuth node sequence, if replacement is enabled, store only a set of baseline file names from `listAuthFiles`. After all OAuth nodes succeed, poll no more than 10 times with 1-second intervals for a file that:

```js
file.name !== item.fileName
&& !baselineNames.has(file.name)
&& (normalizeEmail(file.email) === item.email
  || String(file?.id_token?.chatgpt_account_id || '').trim() === item.accountId)
```

Use the first match. If none appears, throw an error with `reauthStep = 'cpa-file-replace'`. Download that new name, overwrite the original name, then delete only the new name. Store only `replacement: { status: 'replaced' | 'failed' | 'disabled', generatedFileName? }` in item runtime data; never store downloaded credential content.

- [ ] **Step 4: Run tests and commit**

Run: `node --test tests/cpam-reauth-controller.test.js && node --check background/cpam-reauth-controller.js`

Expected: PASS.

Commit:

```powershell
git add -- background/cpam-reauth-controller.js tests/cpam-reauth-controller.test.js
git commit -m "feat: safely replace CPA ReAuth credentials"
```

### Task 4: Add frozen retry and sequential deactivated-file deletion actions

**Files:**

- Modify: `background/cpam-reauth-controller.js`
- Modify: `background/message-router.js`
- Modify: `tests/cpam-reauth-controller.test.js`
- Modify: `tests/background-cpam-reauth-router.test.js`

- [ ] **Step 1: Write failing action tests**

Add controller tests where a completed runtime contains:
- a regular failed item;
- an `account_deactivated` failed item;
- a succeeded item.

Assert `retryFailed()` executes only the regular failed candidate in its original position/order and never calls `getRunCandidates`. Assert `deleteDeactivated()` invokes `deleteAuthFile(item.fileName)` only for the deactivated item, continues after one delete failure, writes `deleteStatus: 'deleted' | 'failed'`, and never re-deletes `deleted` items. Add router tests for `RETRY_CPAM_REAUTH_FAILED` and `DELETE_CPAM_REAUTH_DEACTIVATED`.

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```powershell
node --test tests/cpam-reauth-controller.test.js tests/background-cpam-reauth-router.test.js
```

Expected: FAIL because no action methods or router cases exist.

- [ ] **Step 3: Implement controller action state**

Add `retryFailed` and `deleteDeactivated` public methods. Both reject during active phases. `retryFailed` reads candidates exclusively from persisted `runtime.items`, filtering `status === 'failed'` and excluding the canonical deactivation error. It reruns in ascending original `position`, replaces item status/step/error, and recomputes counts. `deleteDeactivated` filters canonical deactivation failures with a valid `.json` `fileName`, persists `deleting` state around each sequential call, and records user-safe error messages without stopping later entries. Wire router cases to these methods.

- [ ] **Step 4: Run tests and commit**

Run:

```powershell
node --test tests/cpam-reauth-controller.test.js tests/background-cpam-reauth-router.test.js
```

Expected: PASS.

Commit:

```powershell
git add -- background/cpam-reauth-controller.js background/message-router.js tests/cpam-reauth-controller.test.js tests/background-cpam-reauth-router.test.js
git commit -m "feat: add CPAM ReAuth retry and deactivation cleanup"
```

### Task 5: Render setting and guarded terminal actions

**Files:**

- Modify: `sidepanel/sidepanel.html`
- Modify: `sidepanel/sidepanel.js`
- Modify: `sidepanel/cpam-reauth.js`
- Modify: `tests/sidepanel-cpam-reauth.test.js`
- Modify: `sidepanel/i18n-static.js`
- Modify: `tests/i18n-runtime.test.js`

- [ ] **Step 1: Write failing panel tests**

Extend the harness with a checked replacement checkbox and retry/delete buttons. Assert the default setting collects/applies as `true`; a terminal mixed result renders:
`重试 ReAuth（1）` and `删除已停用账户（1）`. Assert retry sends `RETRY_CPAM_REAUTH_FAILED`; delete opens the existing `openConfirmModal` with an explicit count and only sends `DELETE_CPAM_REAUTH_DEACTIVATED` after confirmation. Assert all controls lock during an active/action phase and retry/delete are absent or disabled at zero count.

- [ ] **Step 2: Run the panel test and confirm failure**

Run: `node --test tests/sidepanel-cpam-reauth.test.js`

Expected: FAIL because the switch and terminal action controls do not exist.

- [ ] **Step 3: Implement DOM and panel behaviors**

In the CPAM card add a checked `input[type=checkbox]` with ID `input-cpam-reauth-replace-original-file`, then place retry/delete buttons in the result area. Pass these DOM nodes and an `openConfirmModal` wrapper from `sidepanel.js` to `createCpamReauthPanel`. Include the boolean in `collectSettings`/ `applySettings`; keep it disabled in active/action phases. Render counts from item state and dispatch only the two router message types. Add static English mappings for each new literal.

- [ ] **Step 4: Run focused UI/i18n tests and commit**

Run:

```powershell
node --test tests/sidepanel-cpam-reauth.test.js tests/i18n-runtime.test.js
```

Expected: PASS.

Commit:

```powershell
git add -- sidepanel/cpam-reauth.js sidepanel/sidepanel.html sidepanel/sidepanel.js sidepanel/i18n-static.js tests/sidepanel-cpam-reauth.test.js tests/i18n-runtime.test.js
git commit -m "feat: add CPAM ReAuth recovery controls"
```

### Task 6: Verify end-to-end safety

**Files:**

- Modify only if a regression is identified in the files above.

- [ ] **Step 1: Run syntax and focused CPAM suites**

Run:

```powershell
node --check background/cpa-api.js
node --check background/cpam-reauth-controller.js
node --check background/message-router.js
node --check sidepanel/cpam-reauth.js
node --test tests/cpa-api.test.js tests/cpam-reauth-controller.test.js tests/background-cpam-reauth-router.test.js tests/sidepanel-cpam-reauth.test.js tests/i18n-runtime.test.js
```

Expected: every command exits 0.

- [ ] **Step 2: Run the full suite**

Run: `npm test`

Expected: zero failures.

- [ ] **Step 3: Manual extension checks**

1. With replacement on, reauthenticate an existing 401 file and confirm CPA ends with its original filename and no generated duplicate.
2. With replacement off, confirm the generated OAuth file remains and no list/download/overwrite/delete request is made.
3. Complete a mixed run, retry a transient failure, and verify no new CPAM inspection request occurs.
4. Delete deactivated accounts from the result card; cancel once, then confirm; verify only those original CPA files are deleted and per-item status is shown.
5. Inspect result panel and activity log to confirm no credential JSON, management key, CPAM token, or callback URL appears.

- [ ] **Step 4: Inspect branch state**

Run:

```powershell
git status --short
git log --oneline origin/dev..HEAD
```

Expected: no uncommitted files and feature commits are ready to push to `origin/dev`.

