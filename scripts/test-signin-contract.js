#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INTRO_SOURCE = path.join(ROOT, 'src/screens/auth/SignUpIntroScreen.tsx');
const source = fs.readFileSync(INTRO_SOURCE, 'utf8');

const checks = [
  ['four-step table', (source.match(/\btitle:\s*(?:POST_REQUEST_TITLE|BLAST_TO_OWNERS_TITLE|CHAT_CONFIRM_TITLE|TRADE_POINTS_TITLE),/g) ?? []).length === 4],
  ['videos do not loop', /videoPlayer\.loop\s*=\s*false/.test(source)],
  ['videos start muted', /videoPlayer\.muted\s*=\s*true/.test(source)],
  ['players seek to zero before playback', /seekPlayerSafely\(videoPlayer,\s*0\)/.test(source)],
  ['players pause during setup', /pausePlayerSafely\(videoPlayer\)/.test(source)],
  ['focus lifecycle cleanup exists', /useFocusEffect/.test(source)],
  ['old HTML slide runtime removed', !/signin-animations|window\.__slide|slide\d+\.html/.test(source)],
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
