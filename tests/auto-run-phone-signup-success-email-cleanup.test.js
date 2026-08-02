const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadAutoRunControllerApi() {
  const source = fs.readFileSync('background/auto-run-controller.js', 'utf8');
  const globalScope = {};
  return new Function('self', `${source}; return self.MultiPageBackgroundAutoRunController;`)(globalScope);
}

const FULL_NODE_IDS = [
  'open-chatgpt',
  'submit-signup-email',
  'fill-password',
  'fetch-signup-code',
  'fill-profile',
  'wait-registration-success',
  'oauth-login',
  'fetch-login-code',
  'confirm-oauth',
  'platform-verify',
];

const EMPTY_REGISTRATION_EMAIL_STATE = {
  current: '',
  previous: '',
  source: '',
  updatedAt: 0,
};

const PHONE_NUMBER = '+6612345';
const PHONE_ACTIVATION = {
  activationId: 'signup-completed',
  phoneNumber: PHONE_NUMBER,
};

function createNodeStatuses(doneNodeIds = []) {
  const doneSet = new Set(doneNodeIds);
  return Object.fromEntries(FULL_NODE_IDS.map((nodeId) => [
    nodeId,
    doneSet.has(nodeId) ? 'completed' : 'pending',
  ]));
}

function createBaseState() {
  return {
    activeFlowId: 'openai',
    flowId: 'openai',
    signupMethod: 'phone',
    resolvedSignupMethod: 'phone',
    autoRunFallbackThreadIntervalMinutes: 0,
    autoRunSkipFailures: false,
    nodeStatuses: createNodeStatuses([]),
    stepStatuses: {},
  };
}

function createHarness({ completedNodeIds = [], initialState = {} } = {}) {
  const api = loadAutoRunControllerApi();
  let currentState = {
    ...createBaseState(),
    ...initialState,
  };
  let runCalls = 0;
  let sessionSeed = 1000;
  const clone = (value) => JSON.parse(JSON.stringify(value));

  async function getState() {
    return clone(currentState);
  }

  async function setState(updates = {}) {
    currentState = {
      ...currentState,
      ...updates,
      nodeStatuses: updates.nodeStatuses ? { ...updates.nodeStatuses } : currentState.nodeStatuses,
      stepStatuses: updates.stepStatuses ? { ...updates.stepStatuses } : currentState.stepStatuses,
    };
  }

  async function resetState() {
    currentState = {
      activeFlowId: currentState.activeFlowId,
      flowId: currentState.flowId,
      signupMethod: currentState.signupMethod,
      resolvedSignupMethod: currentState.resolvedSignupMethod,
      autoRunFallbackThreadIntervalMinutes: currentState.autoRunFallbackThreadIntervalMinutes,
      autoRunSkipFailures: currentState.autoRunSkipFailures,
      nodeStatuses: createNodeStatuses([]),
      stepStatuses: {},
      currentPhoneActivation: currentState.currentPhoneActivation,
      phoneNumber: currentState.phoneNumber,
      accountIdentifierType: currentState.accountIdentifierType,
      accountIdentifier: currentState.accountIdentifier,
      signupPhoneNumber: currentState.signupPhoneNumber,
      signupPhoneActivation: currentState.signupPhoneActivation,
      signupPhoneCompletedActivation: currentState.signupPhoneCompletedActivation,
      signupPhoneVerificationRequestedAt: currentState.signupPhoneVerificationRequestedAt,
      signupPhoneVerificationPurpose: currentState.signupPhoneVerificationPurpose,
      currentPhoneVerificationCode: currentState.currentPhoneVerificationCode,
      currentPhoneVerificationCountdownEndsAt: currentState.currentPhoneVerificationCountdownEndsAt,
      currentPhoneVerificationCountdownWindowIndex: currentState.currentPhoneVerificationCountdownWindowIndex,
      currentPhoneVerificationCountdownWindowTotal: currentState.currentPhoneVerificationCountdownWindowTotal,
      email: currentState.email,
      registrationEmailState: currentState.registrationEmailState,
      step8VerificationTargetEmail: currentState.step8VerificationTargetEmail,
      lastEmailTimestamp: currentState.lastEmailTimestamp,
      lastSignupCode: currentState.lastSignupCode,
      lastLoginCode: currentState.lastLoginCode,
      bindEmailSubmitted: currentState.bindEmailSubmitted,
    };
  }

  async function runAutoSequenceFromNode() {
    runCalls += 1;
    if (runCalls === 2) {
      assert.equal(currentState.email, null);
      assert.equal(currentState.currentPhoneActivation, null);
      assert.equal(currentState.phoneNumber, '');
      assert.equal(currentState.signupPhoneNumber, '');
      assert.equal(currentState.accountIdentifierType, null);
      assert.equal(currentState.accountIdentifier, '');
    }

    await setState({
      accountIdentifierType: 'phone',
      accountIdentifier: PHONE_NUMBER,
      currentPhoneActivation: PHONE_ACTIVATION,
      phoneNumber: PHONE_NUMBER,
      signupPhoneNumber: PHONE_NUMBER,
      signupPhoneActivation: PHONE_ACTIVATION,
      signupPhoneCompletedActivation: PHONE_ACTIVATION,
      signupPhoneVerificationRequestedAt: 123,
      signupPhoneVerificationPurpose: 'signup',
      currentPhoneVerificationCode: '222222',
      currentPhoneVerificationCountdownEndsAt: Date.now() + 60000,
      currentPhoneVerificationCountdownWindowIndex: 1,
      currentPhoneVerificationCountdownWindowTotal: 2,
      email: 'bound.user@example.com',
      registrationEmailState: {
        current: 'bound.user@example.com',
        previous: 'old.bound@example.com',
        source: 'bind_email',
        updatedAt: 123,
      },
      step8VerificationTargetEmail: 'bound.user@example.com',
      lastEmailTimestamp: 456,
      lastSignupCode: '111111',
      lastLoginCode: '222222',
      bindEmailSubmitted: true,
      nodeStatuses: createNodeStatuses(completedNodeIds),
    });
  }

  const runtime = {
    state: {},
    get() {
      return { ...this.state };
    },
    set(updates = {}) {
      this.state = { ...this.state, ...updates };
    },
  };

  const controller = api.createAutoRunController({
    addLog: async () => {},
    AUTO_RUN_MAX_RETRIES_PER_ROUND: 3,
    AUTO_RUN_RETRY_DELAY_MS: 3000,
    AUTO_RUN_TIMER_KIND_BEFORE_RETRY: 'before_retry',
    AUTO_RUN_TIMER_KIND_BETWEEN_ROUNDS: 'between_rounds',
    broadcastAutoRunStatus: async () => {},
    broadcastStopToContentScripts: async () => {},
    cancelPendingCommands: () => {},
    clearStopRequest: () => {},
    createAutoRunSessionId: () => {
      sessionSeed += 1;
      return sessionSeed;
    },
    getAutoRunStatusPayload: () => ({}),
    getErrorMessage: (error) => error?.message || String(error || ''),
    getFirstUnfinishedNodeId: () => 'open-chatgpt',
    getNodeIdsForState: () => FULL_NODE_IDS.slice(),
    getPendingAutoRunTimerPlan: () => null,
    getRunningNodeIds: () => [],
    getState,
    getStopRequested: () => false,
    hasSavedNodeProgress: () => false,
    isRestartCurrentAttemptError: () => false,
    isStopError: () => false,
    launchAutoRunTimerPlan: async () => false,
    normalizeAutoRunFallbackThreadIntervalMinutes: () => 0,
    persistAutoRunTimerPlan: async () => {},
    resetState,
    runAutoSequenceFromNode,
    runtime,
    setState,
    sleepWithStop: async () => {},
    throwIfAutoRunSessionStopped: () => {},
    waitForRunningNodesToFinish: getState,
    chrome: {
      runtime: {
        sendMessage: () => Promise.resolve(),
      },
    },
  });

  return {
    controller,
    getState: () => currentState,
  };
}

test('auto-run clears phone signup and bound email runtime only after full workflow success', async () => {
  const { controller, getState } = createHarness({ completedNodeIds: FULL_NODE_IDS });

  await controller.autoRunLoop(1, { mode: 'restart', autoRunSkipFailures: false });

  const state = getState();
  assert.equal(state.email, null);
  assert.deepEqual(state.registrationEmailState, EMPTY_REGISTRATION_EMAIL_STATE);
  assert.equal(state.step8VerificationTargetEmail, '');
  assert.equal(state.lastEmailTimestamp, null);
  assert.equal(state.lastSignupCode, '');
  assert.equal(state.lastLoginCode, '');
  assert.equal(state.bindEmailSubmitted, false);
  assert.equal(state.currentPhoneActivation, null);
  assert.equal(state.currentPhoneVerificationCode, '');
  assert.equal(state.currentPhoneVerificationCountdownEndsAt, 0);
  assert.equal(state.currentPhoneVerificationCountdownWindowIndex, 0);
  assert.equal(state.currentPhoneVerificationCountdownWindowTotal, 0);
  assert.equal(state.accountIdentifierType, null);
  assert.equal(state.accountIdentifier, '');
  assert.equal(state.phoneNumber, '');
  assert.equal(state.signupPhoneNumber, '');
  assert.equal(state.signupPhoneActivation, null);
  assert.equal(state.signupPhoneCompletedActivation, null);
});

test('auto-run keeps phone signup and bound email runtime when workflow is only partially done', async () => {
  const { controller, getState } = createHarness({
    completedNodeIds: ['open-chatgpt', 'submit-signup-email', 'fill-password'],
  });

  await controller.autoRunLoop(1, { mode: 'restart', autoRunSkipFailures: false });

  const state = getState();
  assert.equal(state.email, 'bound.user@example.com');
  assert.deepEqual(state.registrationEmailState, {
    current: 'bound.user@example.com',
    previous: 'old.bound@example.com',
    source: 'bind_email',
    updatedAt: 123,
  });
  assert.equal(state.step8VerificationTargetEmail, 'bound.user@example.com');
  assert.equal(state.lastEmailTimestamp, 456);
  assert.equal(state.lastSignupCode, '111111');
  assert.equal(state.lastLoginCode, '222222');
  assert.equal(state.bindEmailSubmitted, true);
  assert.deepEqual(state.currentPhoneActivation, PHONE_ACTIVATION);
  assert.equal(state.currentPhoneVerificationCode, '222222');
  assert.equal(state.accountIdentifierType, 'phone');
  assert.equal(state.accountIdentifier, PHONE_NUMBER);
  assert.equal(state.phoneNumber, PHONE_NUMBER);
  assert.equal(state.signupPhoneNumber, PHONE_NUMBER);
  assert.deepEqual(state.signupPhoneActivation, PHONE_ACTIVATION);
  assert.deepEqual(state.signupPhoneCompletedActivation, PHONE_ACTIVATION);
});

test('auto-run cleanup prevents next phone signup run from reusing previous identity', async () => {
  const { controller, getState } = createHarness({ completedNodeIds: FULL_NODE_IDS });

  await controller.autoRunLoop(2, { mode: 'restart', autoRunSkipFailures: false });

  const state = getState();
  assert.equal(state.email, null);
  assert.equal(state.currentPhoneActivation, null);
  assert.equal(state.phoneNumber, '');
  assert.equal(state.signupPhoneNumber, '');
  assert.equal(state.accountIdentifierType, null);
  assert.equal(state.accountIdentifier, '');
  assert.equal(state.signupPhoneActivation, null);
  assert.equal(state.signupPhoneCompletedActivation, null);
  assert.equal(state.bindEmailSubmitted, false);
});

test('auto-run cleanup uses frozen resolved signup method instead of stale setting', async () => {
  const emailRun = createHarness({
    completedNodeIds: FULL_NODE_IDS,
    initialState: {
      signupMethod: 'phone',
      resolvedSignupMethod: 'email',
    },
  });

  await emailRun.controller.autoRunLoop(1, { mode: 'restart', autoRunSkipFailures: false });

  assert.equal(emailRun.getState().email, 'bound.user@example.com');
  assert.equal(emailRun.getState().accountIdentifierType, 'phone');

  const phoneRun = createHarness({
    completedNodeIds: FULL_NODE_IDS,
    initialState: {
      signupMethod: 'email',
      resolvedSignupMethod: 'phone',
    },
  });

  await phoneRun.controller.autoRunLoop(1, { mode: 'restart', autoRunSkipFailures: false });

  assert.equal(phoneRun.getState().email, null);
  assert.equal(phoneRun.getState().accountIdentifierType, null);
  assert.equal(phoneRun.getState().signupPhoneNumber, '');
});
