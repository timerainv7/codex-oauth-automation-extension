# OpenAI SUB2API ChatGPT2API Dual Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add a single OpenAI SUB2API switch that appends the existing ChatGPT2API session upload after eligible SUB2API delivery.

**Architecture:** Persist the switch at flows.openai.targets.sub2api.chatgpt2apiUploadEnabled and expose it as openaiSub2apiChatgpt2ApiUploadEnabled to the sidepanel and background. The capability registry derives whether it is visible, active, and valid from effective flow, target, and delivery route. The workflow appends the pre-existing chatgpt2api-session delivery route only after SUB2API Session or Agent Identity.

**Tech Stack:** Manifest V3 extension JavaScript, Node built-in test runner, FlowPilot registry/schema/capability modules.

---

## File Structure

| File | Responsibility |
| --- | --- |
| flows/openai/index.js | Declare the default boolean and add the single row to the SUB2API settings group. |
| core/flow-kernel/settings-schema.js | Normalize the nested value and project the flat sidepanel view. |
| background.js | Persist flat updates and forward the capability-derived value into step definitions. |
| core/flow-kernel/flow-capabilities.js | Gate UI, execution, and startup configuration validation. |
| flows/openai/workflow.js | Append the existing ChatGPT2API publisher step after eligible SUB2API routes. |
| sidepanel/sidepanel.html and sidepanel/sidepanel.js | Render, restore, save, and synchronize exactly one checkbox. |
| tests/*.test.js | Prove schema, background, capability, workflow, and UI behavior. |

### Task 1: Persist the Target-Scoped Switch

**Files:**
- Modify: flows/openai/index.js:68-84, 480-500
- Modify: core/flow-kernel/settings-schema.js:435-470, 579-660, 970-1022
- Modify: background.js:760-835, 1045-1300, 3000-3090, 3690-3760
- Test: tests/flow-registry-settings-schema.test.js
- Test: tests/background-settings-schema-persistence.test.js

- [ ] **Step 1: Write the failing schema tests**

Add this test to tests/flow-registry-settings-schema.test.js:

~~~js
test('settings schema persists the OpenAI SUB2API ChatGPT2API dual delivery switch', () => {
  const { settingsSchema } = loadApis();
  const schema = settingsSchema.createSettingsSchema();
  const defaults = schema.normalizeSettingsState({});
  const enabled = schema.normalizeSettingsState({
    openaiSub2apiChatgpt2ApiUploadEnabled: true,
  });
  const nested = schema.normalizeSettingsState({
    settingsState: {
      flows: { openai: { targets: { sub2api: { chatgpt2apiUploadEnabled: true } } } },
    },
  });

  assert.equal(defaults.flows.openai.targets.sub2api.chatgpt2apiUploadEnabled, false);
  assert.equal(enabled.flows.openai.targets.sub2api.chatgpt2apiUploadEnabled, true);
  assert.equal(schema.buildSettingsView(enabled).openaiSub2apiChatgpt2ApiUploadEnabled, true);
  assert.equal(nested.flows.openai.targets.sub2api.chatgpt2apiUploadEnabled, true);
});
~~~

Extend the existing background persistence harness to save openaiSub2apiChatgpt2ApiUploadEnabled: true and assert that both the flat state and settingsState.flows.openai.targets.sub2api contain true.

- [ ] **Step 2: Run the tests to prove they fail**

Run:

~~~powershell
node --test tests/flow-registry-settings-schema.test.js tests/background-settings-schema-persistence.test.js
~~~

Expected: the new assertions fail because no declared, normalized, projected, or persisted field exists.

- [ ] **Step 3: Implement the minimal schema and persistence path**

In flows/openai/index.js add this field to sub2api.defaultState and add row-openai-sub2api-chatgpt2api-upload to the openai-target-sub2api group:

~~~json
"chatgpt2apiUploadEnabled": false
~~~

In core/flow-kernel/settings-schema.js normalize it only in the OpenAI SUB2API target:

~~~js
chatgpt2apiUploadEnabled: Boolean(targetState.chatgpt2apiUploadEnabled),
~~~

Give explicit flat input priority in normalizeOpenAiSettings:

~~~js
chatgpt2apiUploadEnabled: input?.openaiSub2apiChatgpt2ApiUploadEnabled
  ?? currentFlow.targets.sub2api.chatgpt2apiUploadEnabled,
~~~

Project it from buildSettingsView:

~~~js
next.openaiSub2apiChatgpt2ApiUploadEnabled = Boolean(
  openaiState.targets.sub2api?.chatgpt2apiUploadEnabled
);
~~~

In background.js add the flat field to persisted defaults, schema-view keys, sanitization, and the nested patch:

~~~js
assignIfUpdated(
  'openaiSub2apiChatgpt2ApiUploadEnabled',
  ['flows', 'openai', 'targets', 'sub2api', 'chatgpt2apiUploadEnabled']
);
~~~

Do not add a legacy alias and do not change the schema version. Old configurations normalize to false.

- [ ] **Step 4: Run the schema and persistence tests**

~~~powershell
node --test tests/flow-registry-settings-schema.test.js tests/background-settings-schema-persistence.test.js
~~~

Expected: all tests pass, including existing Grok persistence cases.

- [ ] **Step 5: Commit the persistence layer**

~~~powershell
git add flows/openai/index.js core/flow-kernel/settings-schema.js background.js tests/flow-registry-settings-schema.test.js tests/background-settings-schema-persistence.test.js
git commit -m "feat: persist OpenAI SUB2API dual delivery setting"
~~~

### Task 2: Gate the Feature in Capabilities and Background Resolution

**Files:**
- Modify: core/flow-kernel/flow-capabilities.js:86-94, 312-335, 580-660, 740-870
- Modify: background.js:760-835
- Test: tests/flow-capabilities-module.test.js
- Test: tests/background-signup-method-settings.test.js

- [ ] **Step 1: Write failing capability tests**

Add a test that confirms Session and Agent Identity can activate the option, while OAuth cannot:

~~~js
test('OpenAI SUB2API dual delivery only applies to session-based routes', () => {
  const api = loadApi();
  const registry = api.createFlowCapabilityRegistry();
  const state = {
    activeFlowId: 'openai',
    targetId: 'sub2api',
    accountDeliveryMode: 'agent_identity',
    openaiSub2apiChatgpt2ApiUploadEnabled: true,
    openaiChatgpt2ApiUrl: 'https://chatgpt2api.example.com',
    openaiChatgpt2ApiAdminKey: 'admin-key',
  };
  const enabled = registry.resolveSidepanelCapabilities({ state });
  const oauth = registry.resolveSidepanelCapabilities({
    state: { ...state, accountDeliveryMode: 'oauth' },
  });

  assert.equal(enabled.canShowOpenAiSub2apiChatgpt2ApiUpload, true);
  assert.equal(enabled.stepDefinitionOptions.openaiSub2apiChatgpt2ApiUploadEnabled, true);
  assert.equal(enabled.openaiChatgpt2Api.uploadRequired, true);
  assert.equal(oauth.canShowOpenAiSub2apiChatgpt2ApiUpload, false);
  assert.equal(oauth.stepDefinitionOptions.openaiSub2apiChatgpt2ApiUploadEnabled, false);
  assert.equal(oauth.openaiChatgpt2Api.uploadRequired, false);
});
~~~

Add a missing-config start-validation assertion with code openai_chatgpt2api_config_required. Extend the background step-definition harness to assert that the same capability-derived property reaches MultiPageStepDefinitions.getSteps.

- [ ] **Step 2: Run the focused tests to prove they fail**

~~~powershell
node --test tests/flow-capabilities-module.test.js tests/background-signup-method-settings.test.js
~~~

Expected: the new capability members and forwarding option do not exist.

- [ ] **Step 3: Implement one route-based predicate**

In core/flow-kernel/flow-capabilities.js add a predicate that receives the effective delivery route:

~~~js
function isOpenAiSub2apiChatgpt2ApiDualDelivery(
  activeFlowId,
  targetId,
  accountDeliveryRouteId,
  enabled
) {
  return activeFlowId === 'openai'
    && targetId === 'sub2api'
    && ['sub2api-session', 'sub2api-agent-identity'].includes(accountDeliveryRouteId)
    && Boolean(enabled);
}
~~~

Extend resolveOpenAiChatgpt2ApiState to receive accountDeliveryRouteId, read the flat or nested target setting, return dualUploadEnabled, and set uploadRequired to:

~~~js
targetIsChatgpt2Api || dualUploadEnabled
~~~

Expose canShowOpenAiSub2apiChatgpt2ApiUpload and canEditOpenAiSub2apiChatgpt2ApiUpload. The latter additionally respects auto-run and settings-menu locks. Set stepDefinitionOptions.openaiSub2apiChatgpt2ApiUploadEnabled from dualUploadEnabled, never from raw state.

Update background.js resolution and getStepDefinitionsForState so they forward:

~~~js
openaiSub2apiChatgpt2ApiUploadEnabled: Boolean(
  stepDefinitionOptions.openaiSub2apiChatgpt2ApiUploadEnabled
  ?? state?.openaiSub2apiChatgpt2ApiUploadEnabled
),
~~~

Existing validation must block any active dual delivery without ChatGPT2API URL and Admin Key.

- [ ] **Step 4: Run the capability tests**

~~~powershell
node --test tests/flow-capabilities-module.test.js tests/background-signup-method-settings.test.js
~~~

Expected: only supported routes activate or validate dual delivery.

- [ ] **Step 5: Commit the capability boundary**

~~~powershell
git add core/flow-kernel/flow-capabilities.js background.js tests/flow-capabilities-module.test.js tests/background-signup-method-settings.test.js
git commit -m "feat: validate OpenAI SUB2API dual delivery"
~~~

### Task 3: Compose the Supplemental Delivery Step

**Files:**
- Modify: flows/openai/workflow.js:190-340
- Test: tests/step-definitions-module.test.js

- [ ] **Step 1: Write the failing workflow test**

~~~js
test('OpenAI SUB2API session and Agent Identity delivery can append ChatGPT2API', () => {
  const globalScope = {};
  const api = new Function(
    'self',
    readStepDefinitionsBundle() + '; return self.MultiPageStepDefinitions;'
  )(globalScope);

  for (const accountDeliveryMode of ['session', 'agent_identity']) {
    const options = {
      targetId: 'sub2api',
      accountDeliveryMode,
      openaiSub2apiChatgpt2ApiUploadEnabled: true,
    };
    const steps = api.getSteps(options);
    const nodes = api.getNodes(options);
    assert.equal(steps.at(-2).key, accountDeliveryMode === 'session'
      ? 'sub2api-session-import'
      : 'sub2api-agent-identity-import');
    assert.equal(steps.at(-1).key, 'openai-upload-session-to-chatgpt2api');
    assert.deepEqual(nodes.at(-2).next, ['openai-upload-session-to-chatgpt2api']);
  }

  const oauth = api.getSteps({
    targetId: 'sub2api',
    accountDeliveryMode: 'oauth',
    openaiSub2apiChatgpt2ApiUploadEnabled: true,
  });
  assert.equal(oauth.some((step) => step.key === 'openai-upload-session-to-chatgpt2api'), false);
});
~~~

- [ ] **Step 2: Run the test to prove it fails**

~~~powershell
node --test tests/step-definitions-module.test.js
~~~

Expected: eligible routes lack the appended final step.

- [ ] **Step 3: Implement a guarded supplemental stage**

Keep buildAccountDeliveryStage responsible for only the selected primary route. Add these helpers and append supplementalDelivery after delivery in buildModeStepDefinitions:

~~~js
function isSub2ApiChatgpt2ApiDualDeliveryEnabled(options = {}) {
  const targetId = normalizeTargetId(options?.targetId);
  const routeId = resolveAccountDeliveryRouteId(options);
  return targetId === OPENAI_TARGET_SUB2API
    && ['sub2api-session', 'sub2api-agent-identity'].includes(routeId)
    && Boolean(options?.openaiSub2apiChatgpt2ApiUploadEnabled);
}

function buildSupplementalDeliveryStage(options = {}) {
  return isSub2ApiChatgpt2ApiDualDeliveryEnabled(options)
    ? cloneSteps(ACCOUNT_DELIVERY_STAGE_BY_ROUTE['chatgpt2api-session'])
    : [];
}

function buildModeStepDefinitions(options = {}) {
  const registration = buildRegistrationStage(options);
  const payment = buildPaymentStage(options);
  const delivery = buildAccountDeliveryStage(options);
  const supplementalDelivery = buildSupplementalDeliveryStage(options);
  let steps = [...registration, ...payment, ...delivery, ...supplementalDelivery];
  // Keep the existing phone filtering and reindexing below unchanged.
}
~~~

Do not add a driver or a background command. The appended step must preserve the existing ChatGPT2API publisher identity.

- [ ] **Step 4: Run the workflow suite**

~~~powershell
node --test tests/step-definitions-module.test.js
~~~

Expected: Session and Agent Identity have one appended ChatGPT2API node; OAuth and other targets do not.

- [ ] **Step 5: Commit workflow composition**

~~~powershell
git add flows/openai/workflow.js tests/step-definitions-module.test.js
git commit -m "feat: compose ChatGPT2API after SUB2API delivery"
~~~

### Task 4: Expose Exactly One Sidepanel Switch

**Files:**
- Modify: sidepanel/sidepanel.html:200-230
- Modify: sidepanel/sidepanel.js:120-135, 1160-1420, 5350-5510, 10600-10645, 11818-11900, 14520-14610, 17250-17290, 18950-18980
- Test: tests/sidepanel-flow-source-registry.test.js

- [ ] **Step 1: Write failing UI and synchronization tests**

Add markup assertions for only:

~~~js
'id="row-openai-sub2api-chatgpt2api-upload"',
'id="input-openai-sub2api-chatgpt2api-upload-enabled"',
~~~

Add a step-sync harness analogous to the Grok dual-publish test. Make mocked getSteps return eight items when options.openaiSub2apiChatgpt2ApiUploadEnabled is true, then assert that the option reaches the workflow and the rendered ids include the new node.

Add a focused visibility harness that verifies:

~~~js
api.updateOpenAiSub2ApiChatgpt2ApiUploadUi({
  canShowOpenAiSub2apiChatgpt2ApiUpload: true,
  canEditOpenAiSub2apiChatgpt2ApiUpload: true,
});
assert.equal(api.row.style.display, '');
assert.equal(api.input.disabled, false);

api.updateOpenAiSub2ApiChatgpt2ApiUploadUi({
  canShowOpenAiSub2apiChatgpt2ApiUpload: false,
  canEditOpenAiSub2apiChatgpt2ApiUpload: false,
});
assert.equal(api.row.style.display, 'none');
~~~

- [ ] **Step 2: Run the test to prove it fails**

~~~powershell
node --test tests/sidepanel-flow-source-registry.test.js
~~~

Expected: no new markup, rendering function, or synchronized option exists.

- [ ] **Step 3: Implement the single control and its plumbing**

Add this row adjacent to the OpenAI SUB2API credentials:

~~~html
<div class="data-row" id="row-openai-sub2api-chatgpt2api-upload" style="display:none;">
  <span class="data-label">双交付</span>
  <div class="data-inline">
    <label class="toggle-switch" for="input-openai-sub2api-chatgpt2api-upload-enabled"
      title="开启后在完成 SUB2API 导入后同时导入 ChatGPT2API">
      <input type="checkbox" id="input-openai-sub2api-chatgpt2api-upload-enabled" />
      <span class="toggle-switch-track" aria-hidden="true"><span class="toggle-switch-thumb"></span></span>
    </label>
    <span class="data-value">同时导入 ChatGPT2API</span>
  </div>
</div>
~~~

Add its element references, restored checked state, save payload, DATA_UPDATED handling, and all step-definition forwarding sites. Every forward must use this single option name:

~~~js
openaiSub2apiChatgpt2ApiUploadEnabled:
  stepDefinitionState.openaiSub2apiChatgpt2ApiUploadEnabled,
~~~

Make updatePanelModeUI call a capability-only renderer:

~~~js
function updateOpenAiSub2ApiChatgpt2ApiUploadUi(capabilityState = {}) {
  const visible = Boolean(capabilityState.canShowOpenAiSub2apiChatgpt2ApiUpload);
  const editable = Boolean(capabilityState.canEditOpenAiSub2apiChatgpt2ApiUpload);
  if (rowOpenAiSub2ApiChatgpt2ApiUpload) {
    rowOpenAiSub2ApiChatgpt2ApiUpload.style.display = visible ? '' : 'none';
  }
  if (inputOpenAiSub2ApiChatgpt2ApiUploadEnabled) {
    inputOpenAiSub2ApiChatgpt2ApiUploadEnabled.disabled = !editable;
  }
}
~~~

On checkbox change, synchronize latest state and definitions, rerender statuses and buttons, mark dirty, then use the existing silent save. Do not show ChatGPT2API URL, key, status, or a second source selector in SUB2API mode.

- [ ] **Step 4: Run the sidepanel test**

~~~powershell
node --test tests/sidepanel-flow-source-registry.test.js
~~~

Expected: exactly one control appears only for eligible routes and immediately changes the dynamic step list.

- [ ] **Step 5: Commit the sidepanel control**

~~~powershell
git add sidepanel/sidepanel.html sidepanel/sidepanel.js tests/sidepanel-flow-source-registry.test.js
git commit -m "feat: expose OpenAI SUB2API dual delivery switch"
~~~

### Task 5: Full Regression and Delivery Review

**Files:**
- Modify only a file listed above if a failing regression proves a defect.

- [ ] **Step 1: Run targeted regression suites**

~~~powershell
node --test tests/flow-registry-settings-schema.test.js tests/background-settings-schema-persistence.test.js tests/flow-capabilities-module.test.js tests/background-signup-method-settings.test.js tests/step-definitions-module.test.js tests/sidepanel-flow-source-registry.test.js
~~~

Expected: all targeted tests pass.

- [ ] **Step 2: Run static consistency checks**

~~~powershell
git diff --check
rg -n "openaiSub2apiChatgpt2ApiUploadEnabled|chatgpt2apiUploadEnabled" flows/openai core/flow-kernel background.js sidepanel tests
~~~

Expected: the field appears only in schema, persistence, capabilities, workflow, sidepanel, and tests. No ChatGPT2API configuration row is added to the SUB2API group.

- [ ] **Step 3: Run the complete suite**

~~~powershell
npm test
~~~

Expected: zero failures. This repository has no lint script, so no formatter or lint command is available.

- [ ] **Step 4: Verify delivery state**

~~~powershell
git diff --check
git status --short
git log --oneline -4
~~~

Expected: the feature commits are present, the worktree is clean, and no whitespace error remains.
