#!/usr/bin/env node
/*
 * Headless logic test for the window.__slide contract's master clock.
 *
 * Loads each slide's contract <script> with a mocked DOM (fake
 * document.getAnimations() + a manually-stepped requestAnimationFrame) and
 * asserts the timing behaviour the carousel depends on, without a browser or
 * the iOS Simulator:
 *   - mounted off-screen it is paused at t=0;
 *   - play() runs; the clock advances 1:1 at rate 1 and 3x after setRate(3);
 *   - it loops at durationMs (rewinds, never strands on a final frame);
 *   - deactivate (pause + seek 0) freezes it and it does not advance.
 * Exits non-zero on any failure.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SLIDE_DIR = path.resolve(__dirname, '../assets/signin-animations');

function extractContract(html) {
  return html.match(/<script>([\s\S]*?)<\/script>/)[1];
}
function makeAnim() {
  return {
    currentTime: 0, playbackRate: 1, _playing: true,
    play() { this._playing = true; }, pause() { this._playing = false; },
  };
}

function run(slidePath, durationMs) {
  const code = extractContract(fs.readFileSync(slidePath, 'utf8'));
  const anims = [makeAnim(), makeAnim()];
  let rafCbs = [];
  const document = { getAnimations: () => anims, getElementById: () => null };
  const requestAnimationFrame = (cb) => { rafCbs.push(cb); return rafCbs.length; };
  const window = {};
  new Function('document', 'requestAnimationFrame', 'window', code)(document, requestAnimationFrame, window);
  const slide = window.__slide;

  // Drive realistic ~16ms frames so the contract's tab-switch clamp (dt > 250ms)
  // is never tripped by stepping coarsely.
  let now = 0;
  const frame = () => { const cbs = rafCbs; rafCbs = []; cbs.forEach((cb) => cb(now)); };
  const advance = (ms) => { const end = now + ms; while (now < end) { now = Math.min(end, now + 16); frame(); } };

  let ringMs = null;
  slide.onFrame((ms) => { ringMs = ms; });

  const r = [];
  r.push(['paused-at-load', anims[0]._playing === false && anims[0].currentTime === 0]);
  r.push(['durationMs-matches', slide.durationMs === durationMs]);

  slide.seek(0); slide.play();
  frame();
  advance(2000);
  r.push(['playing-after-play', anims[0]._playing === true]);
  r.push(['clock-advances-1x', ringMs > 1960 && ringMs < 2040]);

  slide.setRate(3);
  r.push(['rate-applied', anims[0].playbackRate === 3]);
  const before = ringMs;
  advance(1000);
  r.push(['advances-3x-on-hold', (ringMs - before) > 2900 && (ringMs - before) < 3100]);

  slide.setRate(1);
  let wrapped = false, maxSeen = 0;
  for (let i = 0; i < Math.ceil(durationMs / 100) + 40; i++) {
    advance(100);
    maxSeen = Math.max(maxSeen, ringMs);
    if (ringMs < before) wrapped = true;
  }
  r.push(['loops-not-freezes', wrapped && maxSeen <= durationMs]);
  r.push(['rewound-still-playing', anims[0]._playing === true]);

  slide.pause(); slide.seek(0);
  r.push(['deactivate-frozen-at-0', anims[0]._playing === false && anims[0].currentTime === 0]);
  advance(5000);
  r.push(['no-advance-while-paused', anims[0].currentTime === 0]);
  return r;
}

const SLIDES = [['slide1.html', 22000], ['slide2.html', 10000], ['slide3.html', 8058]];
let ok = true;
for (const [name, ms] of SLIDES) {
  console.log('==', name, '==');
  for (const [check, pass] of run(path.join(SLIDE_DIR, name), ms)) {
    if (!pass) ok = false;
    console.log('  ', pass ? 'PASS' : 'FAIL', check);
  }
}
console.log(ok ? '\nContract logic OK.' : '\nContract logic FAILED.');
process.exit(ok ? 0 : 1);

