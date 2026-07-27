#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const INTRO_SOURCE = path.join(ROOT, 'src/screens/auth/SignUpIntroScreen.tsx');
const EXPECTED_STEPS = [
  {
    videoConstant: 'ONBOARDING_VIDEO_1',
    video: 'assets/onboarding/onboarding1-hevc-alpha.mov',
    titleConstant: 'POST_REQUEST_TITLE',
    title: 'assets/onboarding/post-pet-care-request.png',
    durationSeconds: 6,
  },
  {
    videoConstant: 'ONBOARDING_VIDEO_2',
    video: 'assets/onboarding/onboarding2-hevc-alpha.mov',
    titleConstant: 'BLAST_TO_OWNERS_TITLE',
    title: 'assets/onboarding/blast-to-pet-owners.png',
    durationSeconds: 10,
  },
  {
    videoConstant: 'ONBOARDING_VIDEO_3',
    video: 'assets/onboarding/onboarding3-cropped-upscaled-hevc-alpha.mov',
    titleConstant: 'CHAT_CONFIRM_TITLE',
    title: 'assets/onboarding/chat-confirm-helping-hand.png',
    durationSeconds: 6,
  },
  {
    videoConstant: 'ONBOARDING_VIDEO_4',
    video: 'assets/onboarding/onboarding4-hevc-alpha.mov',
    titleConstant: 'TRADE_POINTS_TITLE',
    title: 'assets/onboarding/trade-points-not-money.png',
    durationSeconds: 8,
  },
];

const source = fs.readFileSync(INTRO_SOURCE, 'utf8');
const failures = [];

function relativeRequirePattern(relativePath) {
  const fromSource = path.relative(path.dirname(INTRO_SOURCE), path.join(ROOT, relativePath));
  const normalized = fromSource.split(path.sep).join('/');
  return normalized.startsWith('.') ? normalized : `./${normalized}`;
}

function inspectVideo(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,duration',
    '-of', 'json',
    absolutePath,
  ], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) {
    return { error: 'ffprobe could not inspect the video' };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { error: 'ffprobe returned invalid JSON' };
  }
  return parsed?.streams?.[0] ?? { error: 'video stream is missing' };
}

for (const step of EXPECTED_STEPS) {
  for (const relativePath of [step.video, step.title]) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) {
      failures.push(`${relativePath}: file not found`);
    } else if (fs.statSync(absolutePath).size === 0) {
      failures.push(`${relativePath}: file is empty`);
    }
  }

  const videoRequire = `const ${step.videoConstant} = require('${relativeRequirePattern(step.video)}');`;
  const titleRequire = `const ${step.titleConstant} = require('${relativeRequirePattern(step.title)}');`;
  if (!source.includes(videoRequire)) failures.push(`${step.videoConstant}: source require is missing`);
  if (!source.includes(titleRequire)) failures.push(`${step.titleConstant}: source require is missing`);

  if (fs.existsSync(path.join(ROOT, step.video))) {
    const video = inspectVideo(step.video);
    if (video.error) {
      failures.push(`${step.video}: ${video.error}`);
    } else {
      if (video.codec_name !== 'hevc') {
        failures.push(`${step.video}: expected HEVC, found ${video.codec_name ?? 'unknown'}`);
      }
      if (!(Number(video.width) > 0) || !(Number(video.height) > 0)) {
        failures.push(`${step.video}: invalid dimensions`);
      }
      if (Math.abs(Number(video.duration) - step.durationSeconds) > 0.15) {
        failures.push(
          `${step.video}: expected ${step.durationSeconds}s, found ${video.duration ?? 'unknown'}s`,
        );
      }
    }
  }
}

for (const step of EXPECTED_STEPS) {
  const stepPattern = new RegExp(
    `title:\\s*${step.titleConstant},[\\s\\S]{0,100}video:\\s*${step.videoConstant},`,
  );
  if (!stepPattern.test(source)) {
    failures.push(`${step.videoConstant}: missing from INTRO_STEPS in the expected order`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `FAIL  ${failure}`).join('\n'));
  console.error('\nSign-up intro validation FAILED.');
  process.exit(1);
}

console.log(`PASS  ${EXPECTED_STEPS.length} intro steps reference valid bundled media.`);
console.log('PASS  All intro videos are readable HEVC files with expected durations.');
console.log('PASS  Every title and video is wired into INTRO_STEPS.');
console.log('\nSign-up intro assets valid.');
