#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INTRO_SOURCE = path.join(ROOT, 'src/screens/auth/SignUpIntroScreen.tsx');
const SIGN_IN_SOURCE = path.join(ROOT, 'src/screens/auth/SignInScreen.tsx');
const PAYWALL_SOURCE = path.join(ROOT, 'src/screens/onboarding/PaywallScreen.tsx');
const DEFERRED_INTRO_SOURCE = path.join(
  ROOT,
  'src/screens/onboarding/DeferredSignUpIntroScreen.tsx',
);
const source = fs.readFileSync(INTRO_SOURCE, 'utf8');
const signInSource = fs.readFileSync(SIGN_IN_SOURCE, 'utf8');
const paywallSource = fs.readFileSync(PAYWALL_SOURCE, 'utf8');
const deferredIntroSource = fs.readFileSync(DEFERRED_INTRO_SOURCE, 'utf8');

const checks = [
  ['four-step table', (source.match(/\btitle:\s*(?:POST_REQUEST_TITLE|BLAST_TO_OWNERS_TITLE|CHAT_CONFIRM_TITLE|TRADE_POINTS_TITLE),/g) ?? []).length === 4],
  ['videos do not loop', /videoPlayer\.loop\s*=\s*false/.test(source)],
  ['videos start muted', /videoPlayer\.muted\s*=\s*true/.test(source)],
  ['players seek to zero before playback', /seekPlayerSafely\(videoPlayer,\s*0\)/.test(source)],
  ['players pause during setup', /pausePlayerSafely\(videoPlayer\)/.test(source)],
  ['focus lifecycle cleanup exists', /useFocusEffect/.test(source)],
  ['old HTML slide runtime removed', !/signin-animations|window\.__slide|slide\d+\.html/.test(source)],
  [
    'sign-in fallback defers the tutorial before creating an account',
    /await deferSignUpIntro\(\);[\s\S]{0,120}await completePhoneSignUp/.test(signInSource),
  ],
  [
    'paywall checks the deferred tutorial before presenting',
    /shouldShowDeferredSignUpIntro\(\)[\s\S]{0,500}navigation\.replace\('DeferredSignUpIntro'\)/.test(
      paywallSource,
    )
      && /if \(!tutorialGateResolved\) return;[\s\S]{0,500}showPaywall\(\)/.test(paywallSource),
  ],
  [
    'deferred tutorial clears its marker before replacing the paywall',
    /clearDeferredSignUpIntro\(\)[\s\S]{0,200}navigation\.replace\('Paywall'\)/.test(
      deferredIntroSource,
    ),
  ],
];

let passed = true;
for (const [name, result] of checks) {
  if (!result) passed = false;
  console.log(`${result ? 'PASS' : 'FAIL'}  ${name}`);
}

if (!passed) {
  console.error('\nSign-up intro playback contract FAILED.');
  process.exit(1);
}

console.log('\nSign-up intro playback contract valid.');
