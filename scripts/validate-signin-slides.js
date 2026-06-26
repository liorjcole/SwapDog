#!/usr/bin/env node
/*
 * Build-time validation for the sign-in carousel slides.
 *
 * Discovers slides from the SLIDES table in src/screens/auth/SplashScreen.tsx
 * (the source of truth) and asserts, per slide, the contract every slideN.html
 * must honour so a non-compliant export can never merge:
 *
 *   1. 540x1173 design frame present, tagged with a single data-slide-root.
 *   2. window.__slide contract implemented, exporting a numeric durationMs
 *      that matches the slide's durationMs in SplashScreen.tsx.
 *   3. Zero external network requests (no http(s) URLs other than the SVG
 *      xmlns namespace) — fonts, images and video must be embedded/bundled.
 *   4. File weight within the per-slide budget.
 *   5. Single-play timeline — no `infinite` animations.
 *
 * Lightweight by design: a string/DOM check with no headless-browser or npm
 * dependency, so it runs anywhere Node does. Exits non-zero on any failure.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SPLASH = path.join(ROOT, 'src/screens/auth/SplashScreen.tsx');
const SLIDE_DIR = path.join(ROOT, 'assets/signin-animations');
const BUDGET_BYTES = Math.round(1.6 * 1024 * 1024); // ~1.6 MB per slide

function parseSlides(src) {
  // Matches: require('.../slideN.html'), durationMs: 12345
  const re = /require\(['"][^'"]*\/(slide[^'"/]+\.html)['"]\)\s*,\s*durationMs:\s*(\d+)/g;
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({ file: m[1], durationMs: Number(m[2]) });
  }
  return out;
}

function externalRequests(html) {
  const urls = html.match(/https?:\/\/[^"'() \t\r\n]+/g) || [];
  // The SVG xmlns namespace is a declaration, never a network fetch.
  return urls.filter((u) => !/^https?:\/\/www\.w3\.org\//.test(u));
}

function checkSlide(slide) {
  const failures = [];
  const file = path.join(SLIDE_DIR, slide.file);
  if (!fs.existsSync(file)) {
    return [`${slide.file}: file not found`];
  }
  const html = fs.readFileSync(file, 'utf8');
  const bytes = Buffer.byteLength(html);

  // 1. Design frame + single scene root.
  if (!/width:540px;height:1173px/.test(html)) {
    failures.push('missing 540x1173 design frame');
  }
  const roots = (html.match(/data-slide-root/g) || []).length;
  if (roots !== 1) {
    failures.push(`expected exactly one data-slide-root, found ${roots}`);
  }

  // 2. Contract implemented with a matching durationMs.
  if (!/window\.__slide\s*=/.test(html)) {
    failures.push('window.__slide contract not implemented');
  }
  for (const member of ['durationMs', 'play', 'pause', 'seek', 'setRate', 'onFrame']) {
    if (!new RegExp(member + '\\s*:').test(html) && !new RegExp(member + '\\s*=').test(html)) {
      failures.push(`contract missing member: ${member}`);
    }
  }
  const dm = html.match(/var DURATION\s*=\s*(\d+)/);
  if (!dm) {
    failures.push('no `var DURATION = <ms>` in contract');
  } else if (Number(dm[1]) !== slide.durationMs) {
    failures.push(`durationMs mismatch: HTML ${dm[1]} vs SplashScreen ${slide.durationMs}`);
  }

  // 3. Zero external network requests.
  const ext = externalRequests(html);
  if (ext.length) {
    failures.push(`external network request(s): ${[...new Set(ext)].join(', ')}`);
  }

  // 4. Weight budget.
  if (bytes > BUDGET_BYTES) {
    failures.push(`over budget: ${(bytes / 1024).toFixed(0)}KB > ${(BUDGET_BYTES / 1024).toFixed(0)}KB`);
  }

  // 5. Finite single-play timeline.
  if (/\binfinite\b/.test(html)) {
    failures.push('contains `infinite` animation(s) — slides must be single-play');
  }

  return failures.map((f) => `${slide.file}: ${f}`).concat(
    failures.length ? [] : [`${slide.file}: OK (${(bytes / 1024).toFixed(0)}KB, ${slide.durationMs}ms)`]
  );
}

function main() {
  const slides = parseSlides(fs.readFileSync(SPLASH, 'utf8'));
  if (!slides.length) {
    console.error('No slides found in SplashScreen.tsx SLIDES table.');
    process.exit(2);
  }
  let ok = true;
  const lines = [];
  for (const slide of slides) {
    const results = checkSlide(slide);
    for (const r of results) {
      const pass = / OK \(/.test(r);
      if (!pass) ok = false;
      lines.push(`${pass ? 'PASS' : 'FAIL'}  ${r}`);
    }
  }
  console.log(lines.join('\n'));
  console.log(ok ? '\nAll sign-in slides valid.' : '\nSign-in slide validation FAILED.');
  process.exit(ok ? 0 : 1);
}

main();

