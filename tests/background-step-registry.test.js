const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('background imports node registry and wires the rebuilt Kiro executors', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /core\/flow-kernel\/step-registry\.js/);
  assert.match(source, /data\/step-definitions\.js/);
  assert.match(source, /core\/flow-kernel\/workflow-engine\.js/);
  assert.match(source, /MultiPageStepDefinitions\?\.getNodes/);
  assert.match(source, /buildNodeRegistry\(definitions/);
  assert.match(source, /const stepRegistryCache = new Map\(\);/);
  assert.match(source, /const definitions = getNodeDefinitionsForState\(state\);/);
  assert.match(source, /stepRegistryCache\.set\(cacheKey, buildStepRegistry\(definitions\)\)/);

  assert.match(source, /flows\/kiro\/background\/register-runner\.js/);
  assert.match(source, /flows\/kiro\/background\/desktop-client\.js/);
  assert.match(source, /flows\/kiro\/background\/desktop-authorize-runner\.js/);
  assert.match(source, /flows\/kiro\/background\/publisher-kiro-rs\.js/);
  assert.match(source, /flows\/grok\/background\/state\.js/);
  assert.match(source, /flows\/grok\/background\/register-runner\.js/);
  assert.match(source, /flows\/grok\/background\/publisher-webchat2api\.js/);
  assert.match(source, /flows\/grok\/background\/publisher-grok2api\.js/);
  assert.match(source, /flows\/grok\/background\/sub2api-oauth-runner\.js/);
  assert.match(source, /flows\/openai\/background\/session-reader\.js/);
  assert.match(source, /flows\/openai\/background\/publisher-webchat\.js/);
  assert.doesNotMatch(source, /background\/steps\/kiro-device-auth\.js/);

  assert.match(source, /const kiroRegisterRunner = self\.MultiPageBackgroundKiroRegisterRunner\?\.createKiroRegisterRunner\(/);
  assert.match(source, /const kiroDesktopAuthorizeRunner = self\.MultiPageBackgroundKiroDesktopAuthorizeRunner\?\.createKiroDesktopAuthorizeRunner\(/);
  assert.match(source, /const kiroPublisher = self\.MultiPageBackgroundKiroPublisherKiroRs\?\.createKiroRsPublisher\(/);
  assert.match(source, /const grokRegisterRunner = self\.MultiPageBackgroundGrokRegisterRunner\?\.createGrokRegisterRunner\(/);
  assert.match(source, /const grokWebchat2ApiPublisher = self\.MultiPageBackgroundGrokPublisherWebchat2Api\?\.createGrokWebchat2ApiPublisher\(/);
  assert.match(source, /const grok2ApiPublisher = self\.MultiPageBackgroundGrokPublisherGrok2Api\?\.createGrok2ApiPublisher\(/);
  assert.match(source, /const grokSub2ApiOAuthRunner = self\.MultiPageBackgroundGrokSub2ApiOAuthRunner\?\.createGrokSub2ApiOAuthRunner\(/);
  assert.match(source, /const openAiWebchatPublisher = self\.MultiPageBackgroundOpenAiPublisherWebchat\?\.createOpenAiWebchatPublisher\(/);

  assert.match(source, /'kiro-open-register-page': \(state\) => kiroRegisterRunner\.executeKiroOpenRegisterPage\(state\)/);
  assert.match(source, /'kiro-submit-email': \(state\) => kiroRegisterRunner\.executeKiroSubmitEmail\(state\)/);
  assert.match(source, /'kiro-submit-name': \(state\) => kiroRegisterRunner\.executeKiroSubmitName\(state\)/);
  assert.match(source, /'kiro-submit-verification-code': \(state\) => kiroRegisterRunner\.executeKiroSubmitVerificationCode\(state\)/);
  assert.match(source, /'kiro-submit-password': \(state\) => kiroRegisterRunner\.executeKiroSubmitPassword\(state\)/);
  assert.match(source, /'kiro-complete-register-consent': \(state\) => kiroRegisterRunner\.executeKiroCompleteRegisterConsent\(state\)/);
  assert.match(source, /'kiro-start-desktop-authorize': \(state\) => kiroDesktopAuthorizeRunner\.executeKiroStartDesktopAuthorize\(state\)/);
  assert.match(source, /'kiro-complete-desktop-authorize': \(state\) => kiroDesktopAuthorizeRunner\.executeKiroCompleteDesktopAuthorize\(state\)/);
  assert.match(source, /'kiro-upload-credential': \(state\) => kiroPublisher\.executeKiroUploadCredential\(state\)/);
  assert.match(source, /'grok-open-signup-page': \(state\) => grokRegisterRunner\.executeGrokOpenSignupPage\(state\)/);
  assert.match(source, /'grok-submit-email': \(state\) => grokRegisterRunner\.executeGrokSubmitEmail\(state\)/);
  assert.match(source, /'grok-submit-verification-code': \(state\) => grokRegisterRunner\.executeGrokSubmitVerificationCode\(state\)/);
  assert.match(source, /'grok-submit-profile': \(state\) => grokRegisterRunner\.executeGrokSubmitProfile\(state\)/);
  assert.match(source, /'grok-extract-sso-cookie': \(state\) => grokRegisterRunner\.executeGrokExtractSsoCookie\(state\)/);
  assert.match(source, /'grok-upload-sso-to-webchat2api': \(state\) => grokWebchat2ApiPublisher\.executeGrokUploadSsoToWebchat2Api\(state\)/);
  assert.match(source, /'grok-upload-sso-to-grok2api': \(state\) => grok2ApiPublisher\.executeGrokUploadSsoToGrok2Api\(state\)/);
  assert.match(source, /'grok-start-sub2api-oauth': \(state\) => grokSub2ApiOAuthRunner\.executeGrokStartSub2ApiOAuth\(state\)/);
  assert.match(source, /'grok-complete-sub2api-oauth': \(state\) => grokSub2ApiOAuthRunner\.executeGrokCompleteSub2ApiOAuth\(state\)/);
  assert.match(source, /async function requestStop\([\s\S]*typeof grokSub2ApiOAuthRunner !== 'undefined'[\s\S]*grokSub2ApiOAuthRunner\?\.cleanupAuthorizationTab\(\)/);
  assert.match(source, /'openai-upload-session-to-webchat': \(state\) => openAiWebchatPublisher\.executeOpenAiUploadSessionToWebchat\(state\)/);

  assert.match(
    source,
    /'kiro-open-register-page',[\s\S]*'kiro-submit-email',[\s\S]*'kiro-submit-name',[\s\S]*'kiro-submit-verification-code',[\s\S]*'kiro-submit-password',[\s\S]*'kiro-complete-register-consent',[\s\S]*'kiro-start-desktop-authorize',[\s\S]*'kiro-complete-desktop-authorize',[\s\S]*'kiro-upload-credential'/
  );
  assert.match(
    source,
    /'grok-open-signup-page',[\s\S]*'grok-submit-email',[\s\S]*'grok-submit-verification-code',[\s\S]*'grok-submit-profile',[\s\S]*'grok-extract-sso-cookie',[\s\S]*'grok-upload-sso-to-webchat2api'/
  );
  assert.match(
    source,
    /AUTO_RUN_BACKGROUND_COMPLETED_STEP_KEYS[\s\S]*'grok-upload-sso-to-grok2api'[\s\S]*'grok-start-sub2api-oauth'[\s\S]*'grok-complete-sub2api-oauth'/
  );
  assert.match(source, /'openai-upload-session-to-webchat'/);
});

test('background builds default node status coverage from every registered flow', () => {
  const source = fs.readFileSync('background.js', 'utf8');

  assert.match(source, /const REGISTERED_STEP_FLOW_IDS = self\.MultiPageStepDefinitions\?\.getRegisteredFlowIds\?\.\(\)/);
  assert.match(source, /for \(const flowId of REGISTERED_STEP_FLOW_IDS\)/);
  assert.match(source, /getAllSteps\(\{ activeFlowId: flowId \}\)/);
});

test('background no longer wires removed payment executors or OTP helpers', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.doesNotMatch(source, /create[A-Z][A-Za-z]+ApproveExecutor\(\{[\s\S]*request[A-Z][A-Za-z]+OtpInput/);
  assert.doesNotMatch(source, /REQUEST_[A-Z]+_OTP_INPUT/);
});
